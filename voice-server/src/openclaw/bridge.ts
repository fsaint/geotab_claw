/**
 * OpenClaw Bridge
 *
 * Bridges Twilio Media Streams with OpenClaw Gateway using:
 * - VAD for speech detection
 * - Whisper for STT
 * - OpenClaw Gateway for LLM (Claude + Geotab MCP)
 * - TTS for speech synthesis
 *
 * State Machine:
 * IDLE -> LISTENING -> PROCESSING -> SPEAKING -> IDLE
 *                                      |
 *                              INTERRUPTED -> LISTENING
 */

import WebSocket from 'ws';
import {
  mulawToPcm8k,
  pcmToWav,
  pcm24kToMulaw,
} from '../audio/converter';
import { VoiceActivityDetector } from '../stt/vad';
import { transcribe, AudioBuffer } from '../stt/whisper';
import {
  createOpenClawSession,
  getOpenClawSession,
  closeOpenClawSession,
  sendTranscription,
  sendToolResult,
  triggerGreeting,
  OpenClawSession,
} from './session';
import { orchestrator } from '../agent/orchestrator';
import { contextStore } from '../agent/context';
import { getVehicleStatus, getFleetOverview } from '../fleet/geotab-client';
import { findDriverByName, findDriverByVehicle, bossPhone, Driver } from '../contacts/drivers';
import { PersonaType } from '../agent/personas';
import { initiateOutboundCall } from '../routes/outbound';
import { config } from '../config';
import { TTSProvider, TTSChunk, createTTSWithFallback } from '../tts';

type BridgeState = 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted';

interface TwilioStreamMessage {
  event: string;
  streamSid?: string;
  start?: {
    streamSid: string;
    callSid: string;
    customParameters?: Record<string, string>;
  };
  media?: {
    payload: string;
  };
  stop?: {
    callSid: string;
  };
}

interface OpenClawBridgeSession {
  callSid: string;
  streamSid: string | null;
  state: BridgeState;
  twilioWs: WebSocket;
  openclawSession: OpenClawSession | null;
  vad: VoiceActivityDetector;
  audioBuffer: AudioBuffer;
  tts: TTSProvider;
  isSpeaking: boolean;
  pendingTTSText: string;
  speakingChunks: Buffer[];
}

const bridgeSessions = new Map<string, OpenClawBridgeSession>();

/**
 * Handle Twilio stream with OpenClaw backend
 */
export async function handleOpenClawStream(
  twilioWs: WebSocket,
  callSid: string,
  callerPhone: string,
  personaType: PersonaType,
  driver?: Driver
): Promise<void> {
  console.log(`[OpenClawBridge] Setting up bridge for call ${callSid}, persona: ${personaType}`);

  // Initialize TTS provider with fallback
  const tts = createTTSWithFallback();

  // Create bridge session
  const bridge: OpenClawBridgeSession = {
    callSid,
    streamSid: null,
    state: 'idle',
    twilioWs,
    openclawSession: null,
    vad: new VoiceActivityDetector({
      threshold: 0.02,
      silenceDuration: 600,
      minSpeechDuration: 150,
    }),
    audioBuffer: new AudioBuffer(30000, 8000),
    tts,
    isSpeaking: false,
    pendingTTSText: '',
    speakingChunks: [],
  };

  bridgeSessions.set(callSid, bridge);

  // Create OpenClaw session
  try {
    const session = await createOpenClawSession(callSid, personaType, driver);
    bridge.openclawSession = session;

    // Set up OpenClaw event handlers
    session.onMessageDelta = (delta: string) => {
      handleAssistantDelta(bridge, delta);
    };

    session.onMessageComplete = (content: string) => {
      handleAssistantComplete(bridge, content);
    };

    session.onToolCall = (toolCallId: string, name: string, args: Record<string, unknown>) => {
      handleToolCall(bridge, toolCallId, name, args);
    };

    session.onError = (error) => {
      console.error(`[OpenClawBridge] OpenClaw error:`, error);
    };
  } catch (err) {
    console.error(`[OpenClawBridge] Failed to create OpenClaw session:`, err);
    // Could fall back to OpenAI Realtime here
  }

  // Handle Twilio messages
  twilioWs.on('message', (data: WebSocket.Data) => {
    try {
      const msg: TwilioStreamMessage = JSON.parse(data.toString());
      handleTwilioMessage(bridge, msg);
    } catch (err) {
      console.error('[OpenClawBridge] Error processing Twilio message:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log(`[OpenClawBridge] Twilio WebSocket closed`);
    cleanup(bridge);
  });

  twilioWs.on('error', (err) => {
    console.error(`[OpenClawBridge] Twilio WebSocket error:`, err);
  });
}

/**
 * Handle incoming Twilio messages
 */
function handleTwilioMessage(bridge: OpenClawBridgeSession, msg: TwilioStreamMessage): void {
  switch (msg.event) {
    case 'start':
      bridge.streamSid = msg.start?.streamSid || null;
      console.log(`[OpenClawBridge] Twilio stream started: ${bridge.streamSid}`);
      orchestrator.setStreamSid(bridge.callSid, bridge.streamSid!);
      bridge.state = 'listening';

      // Trigger greeting after a short delay
      setTimeout(() => {
        if (bridge.openclawSession?.isReady) {
          triggerGreeting(bridge.callSid);
        }
      }, 500);
      break;

    case 'media':
      if (msg.media?.payload) {
        handleAudioInput(bridge, msg.media.payload);
      }
      break;

    case 'stop':
      console.log(`[OpenClawBridge] Twilio stream stopped`);
      cleanup(bridge);
      break;
  }
}

/**
 * Handle incoming audio from Twilio
 */
function handleAudioInput(bridge: OpenClawBridgeSession, base64Audio: string): void {
  // Decode mulaw audio
  const mulawData = Buffer.from(base64Audio, 'base64');

  // Convert to PCM for VAD
  const pcmData = mulawToPcm8k(mulawData);
  const pcmSamples = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);

  // Run VAD
  const vadResult = bridge.vad.process(pcmSamples);

  // Handle state transitions based on VAD
  if (vadResult.speechStarted) {
    console.log(`[OpenClawBridge] Speech started`);

    // If we're speaking, interrupt
    if (bridge.state === 'speaking') {
      bridge.state = 'interrupted';
      bridge.speakingChunks = [];
      bridge.pendingTTSText = '';
      // Clear Twilio audio buffer
      if (bridge.streamSid) {
        bridge.twilioWs.send(JSON.stringify({
          event: 'clear',
          streamSid: bridge.streamSid,
        }));
      }
    }

    bridge.state = 'listening';
  }

  // Accumulate audio while listening
  if (bridge.state === 'listening' && bridge.vad.isSpeaking()) {
    bridge.audioBuffer.append(pcmData);
  }

  // When speech ends, transcribe
  if (vadResult.speechEnded && bridge.audioBuffer.hasData()) {
    console.log(`[OpenClawBridge] Speech ended, transcribing ${bridge.audioBuffer.getDurationMs()}ms of audio`);
    bridge.state = 'processing';
    processAudioBuffer(bridge);
  }
}

/**
 * Process accumulated audio buffer through Whisper STT
 */
async function processAudioBuffer(bridge: OpenClawBridgeSession): Promise<void> {
  try {
    // Get audio and convert to WAV
    const pcmBuffer = bridge.audioBuffer.getBuffer();
    const wavBuffer = pcmToWav(pcmBuffer, 8000, 1);

    // Clear buffer for next utterance
    bridge.audioBuffer.clear();

    // Transcribe with Whisper
    const result = await transcribe(wavBuffer);

    if (result.text.trim()) {
      console.log(`[OpenClawBridge] Transcription: "${result.text}"`);

      // Send to OpenClaw
      sendTranscription(bridge.callSid, result.text);
    } else {
      // No speech detected, go back to listening
      bridge.state = 'listening';
    }
  } catch (err) {
    console.error('[OpenClawBridge] Transcription error:', err);
    bridge.state = 'listening';
  }
}

/**
 * Handle assistant message delta (streaming)
 */
function handleAssistantDelta(bridge: OpenClawBridgeSession, delta: string): void {
  bridge.pendingTTSText += delta;

  // Stream TTS when we have enough text (at sentence boundaries)
  if (shouldStreamTTS(bridge.pendingTTSText)) {
    const textToSpeak = bridge.pendingTTSText;
    bridge.pendingTTSText = '';
    bridge.state = 'speaking';
    streamTTS(bridge, textToSpeak);
  }
}

/**
 * Handle assistant message complete
 */
function handleAssistantComplete(bridge: OpenClawBridgeSession, content: string): void {
  // Speak any remaining text
  if (bridge.pendingTTSText.trim()) {
    const textToSpeak = bridge.pendingTTSText;
    bridge.pendingTTSText = '';
    bridge.state = 'speaking';
    streamTTS(bridge, textToSpeak);
  }
}

/**
 * Check if we should stream TTS (at sentence boundaries)
 */
function shouldStreamTTS(text: string): boolean {
  // Stream at sentence boundaries for lower latency
  const sentenceEnders = /[.!?]\s*$/;
  return text.length > 20 && sentenceEnders.test(text);
}

/**
 * Stream TTS audio to Twilio
 */
async function streamTTS(bridge: OpenClawBridgeSession, text: string): Promise<void> {
  if (!text.trim()) return;

  console.log(`[OpenClawBridge] TTS: "${text}"`);

  try {
    bridge.isSpeaking = true;

    await bridge.tts.synthesizeStream(text, (chunk: TTSChunk) => {
      // Check if we were interrupted
      if (bridge.state === 'interrupted' || !bridge.isSpeaking) {
        return;
      }

      if (chunk.audio.length > 0) {
        // Convert PCM 24kHz to mulaw 8kHz for Twilio
        const mulawData = pcm24kToMulaw(chunk.audio);

        // Send to Twilio
        if (bridge.streamSid && bridge.twilioWs.readyState === WebSocket.OPEN) {
          bridge.twilioWs.send(JSON.stringify({
            event: 'media',
            streamSid: bridge.streamSid,
            media: {
              payload: mulawData.toString('base64'),
            },
          }));
        }
      }

      if (chunk.isLast) {
        bridge.isSpeaking = false;
        if (bridge.state === 'speaking') {
          bridge.state = 'listening';
        }
      }
    });
  } catch (err) {
    console.error('[OpenClawBridge] TTS error:', err);
    bridge.isSpeaking = false;
    bridge.state = 'listening';
  }
}

/**
 * Handle tool calls from OpenClaw
 */
async function handleToolCall(
  bridge: OpenClawBridgeSession,
  toolCallId: string,
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  console.log(`[OpenClawBridge] Tool call: ${name}(${JSON.stringify(args)})`);

  let result: unknown;

  try {
    switch (name) {
      case 'get_vehicle_status': {
        const vehicleName = (args.vehicle as string) || '';
        let vehicle = vehicleName;
        const driver = findDriverByName(vehicleName);
        if (driver) {
          vehicle = driver.vehicle;
        }

        const status = await getVehicleStatus(vehicle);
        if (status) {
          let stoppedMinutes: number | undefined;
          if (status.currentStateDuration && !status.isDriving) {
            const match = status.currentStateDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
              stoppedMinutes =
                (parseInt(match[1] || '0') * 60) + parseInt(match[2] || '0') + parseInt(match[3] || '0') / 60;
            }
          }

          contextStore.setVehicleStatus({
            vehicle: status.name,
            speed: status.speed || 0,
            stoppedMinutes: stoppedMinutes ? Math.round(stoppedMinutes) : undefined,
            location: `${status.latitude}, ${status.longitude}`,
            isDriving: status.isDriving,
          });

          result = {
            vehicle: status.name,
            status: status.isDriving ? 'driving' : 'stopped',
            speed: `${status.speed || 0} mph`,
            stopped_for: stoppedMinutes ? `${Math.round(stoppedMinutes)} minutes` : undefined,
            location: status.latitude && status.longitude
              ? `${status.latitude.toFixed(4)}, ${status.longitude.toFixed(4)}`
              : 'Unknown',
            communicating: status.isDeviceCommunicating,
          };
        } else {
          result = { error: `Vehicle "${vehicleName}" not found` };
        }
        break;
      }

      case 'get_fleet_overview': {
        const overview = await getFleetOverview();
        result = {
          total_vehicles: overview.total,
          driving: overview.driving,
          stopped: overview.stopped,
          offline: overview.offline,
          vehicles: overview.vehicles.slice(0, 10).map((v) => ({
            name: v.name,
            status: v.status,
            speed: v.speed !== null ? `${v.speed} mph` : 'N/A',
          })),
        };
        break;
      }

      case 'initiate_call': {
        const target = (args.target as string) || '';
        const reason = (args.reason as string) || '';
        const context = (args.context as string) || '';

        let phone: string;

        if (target.toLowerCase() === 'boss') {
          phone = bossPhone;
        } else {
          const driver = findDriverByName(target);
          if (driver) {
            phone = driver.phone;
          } else {
            result = { error: `Driver "${target}" not found` };
            break;
          }
        }

        orchestrator.scheduleOutbound(target, phone, reason, context);

        result = {
          status: 'scheduled',
          message: `Will call ${target} after this call ends`,
          target,
          reason,
        };
        break;
      }

      case 'end_current_call': {
        const summary = (args.summary as string) || '';
        orchestrator.endCall(bridge.callSid, summary);

        if (bridge.streamSid) {
          bridge.twilioWs.send(JSON.stringify({
            event: 'clear',
            streamSid: bridge.streamSid,
          }));
        }

        result = { status: 'ending', summary };
        break;
      }

      case 'save_context': {
        if (args.boss_asked_about || args.vehicle || args.deadline) {
          contextStore.setBossQuery({
            askedAbout: args.boss_asked_about as string,
            vehicle: args.vehicle as string,
            deadline: args.deadline as string,
          });
        }
        if (args.driver_said || args.driver_commitment) {
          contextStore.setDriverResponse({
            said: args.driver_said as string,
            commitment: args.driver_commitment as string,
          });
        }
        if (args.diplomatic_response) {
          contextStore.setDiplomaticResponse({
            forBoss: args.diplomatic_response as string,
          });
        }
        result = { status: 'saved' };
        break;
      }

      default:
        result = { error: `Unknown function: ${name}` };
    }
  } catch (err) {
    console.error(`[OpenClawBridge] Error in tool ${name}:`, err);
    result = { error: String(err) };
  }

  // Send result back to OpenClaw
  sendToolResult(bridge.callSid, toolCallId, result);
}

/**
 * Clean up bridge session
 */
function cleanup(bridge: OpenClawBridgeSession): void {
  closeOpenClawSession(bridge.callSid);
  orchestrator.endCall(bridge.callSid);
  bridgeSessions.delete(bridge.callSid);

  // Check for pending outbound calls
  const pending = orchestrator.consumePendingOutbound();
  if (pending) {
    console.log(`[OpenClawBridge] Initiating pending outbound call to ${pending.target}`);
    initiateOutboundCall(pending.phone, pending.target, pending.reason).catch((err) => {
      console.error('[OpenClawBridge] Failed to initiate outbound call:', err);
    });
  }
}
