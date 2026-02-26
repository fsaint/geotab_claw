/**
 * OpenClaw Bridge
 *
 * Bridges Twilio Media Streams with OpenClaw Gateway using:
 * - VAD for speech detection
 * - Whisper for STT
 * - OpenClaw Gateway for LLM (Claude + Geotab MCP via nodes)
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
  closeOpenClawSession,
  sendTranscription,
  triggerGreeting,
  interruptResponse,
  OpenClawSession,
} from './session';
import { orchestrator } from '../agent/orchestrator';
import { PersonaType } from '../agent/personas';
import { Driver } from '../contacts/drivers';
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
  };

  bridgeSessions.set(callSid, bridge);

  // Create OpenClaw session
  try {
    const session = await createOpenClawSession(callSid, personaType, driver);
    bridge.openclawSession = session;

    // Set up OpenClaw event handlers
    session.onTextDelta = (text: string) => {
      handleTextDelta(bridge, text);
    };

    session.onTextComplete = (text: string) => {
      handleTextComplete(bridge, text);
    };

    session.onToolCall = (toolId: string, name: string, input: Record<string, unknown>) => {
      // Tools are handled by OpenClaw's MCP nodes (Geotab MCP server)
      // We just log them here for visibility
      console.log(`[OpenClawBridge] Tool call (handled by MCP): ${name}`, input);
    };

    session.onError = (error) => {
      console.error(`[OpenClawBridge] OpenClaw error:`, error);
    };

  } catch (err) {
    console.error(`[OpenClawBridge] Failed to create OpenClaw session:`, err);
    // Session creation failed - call will work but without AI
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
      bridge.isSpeaking = false;
      bridge.pendingTTSText = '';

      // Abort the current OpenClaw response
      interruptResponse(bridge.callSid);

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
      await sendTranscription(bridge.callSid, result.text);
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
 * Handle text delta (streaming) from OpenClaw
 */
function handleTextDelta(bridge: OpenClawBridgeSession, delta: string): void {
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
 * Handle text complete from OpenClaw
 */
function handleTextComplete(bridge: OpenClawBridgeSession, content: string): void {
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
 * Clean up bridge session
 */
function cleanup(bridge: OpenClawBridgeSession): void {
  closeOpenClawSession(bridge.callSid);
  orchestrator.endCall(bridge.callSid);
  bridgeSessions.delete(bridge.callSid);
}
