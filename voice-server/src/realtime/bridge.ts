import WebSocket from 'ws';
import { convertTwilioToOpenAI, convertOpenAIToTwilio } from '../audio/converter';
import {
  createSession,
  getSession,
  closeSession,
  sendAudio,
  sendFunctionResult,
  triggerGreeting,
  RealtimeSession,
} from './session';
import { orchestrator } from '../agent/orchestrator';
import { contextStore } from '../agent/context';
import { getVehicleStatus, getFleetOverview } from '../fleet/geotab-client';
import { findDriverByName, findDriverByVehicle, bossPhone, Driver } from '../contacts/drivers';
import { PersonaType } from '../agent/personas';
import { initiateOutboundCall } from '../routes/outbound';

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

export function handleTwilioStream(
  twilioWs: WebSocket,
  callSid: string,
  callerPhone: string,
  personaType: PersonaType,
  driver?: Driver
): void {
  console.log(`[Bridge] Setting up bridge for call ${callSid}, persona: ${personaType}`);

  let streamSid: string | undefined;
  let openaiSession: RealtimeSession | undefined;

  // Handle events from OpenAI Realtime
  const handleOpenAIEvent = (event: unknown, session: RealtimeSession) => {
    const evt = event as {
      type: string;
      delta?: string;
      name?: string;
      call_id?: string;
      arguments?: string;
      response?: { output?: Array<{ type: string; name?: string; call_id?: string; arguments?: string }> };
    };

    switch (evt.type) {
      case 'response.audio.delta':
        // Convert and send audio to Twilio
        if (evt.delta && streamSid) {
          const twilioAudio = convertOpenAIToTwilio(evt.delta);
          twilioWs.send(
            JSON.stringify({
              event: 'media',
              streamSid,
              media: {
                payload: twilioAudio,
              },
            })
          );
        }
        break;

      case 'response.function_call_arguments.done':
        // Handle function calls
        handleFunctionCall(callSid, evt.name!, evt.call_id!, evt.arguments || '{}', twilioWs);
        break;

      case 'response.done':
        // Check for function calls in the response
        if (evt.response?.output) {
          for (const output of evt.response.output) {
            if (output.type === 'function_call') {
              handleFunctionCall(callSid, output.name!, output.call_id!, output.arguments || '{}', twilioWs);
            }
          }
        }
        break;

      case 'input_audio_buffer.speech_started':
        console.log(`[Bridge] User started speaking`);
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log(`[Bridge] User stopped speaking`);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        const transcriptEvt = event as { transcript?: string };
        if (transcriptEvt.transcript) {
          console.log(`[Bridge] User said: "${transcriptEvt.transcript}"`);
        }
        break;
    }
  };

  // Create OpenAI session
  openaiSession = createSession(callSid, personaType, driver, handleOpenAIEvent);

  // Handle Twilio messages
  twilioWs.on('message', (data: WebSocket.Data) => {
    try {
      const msg: TwilioStreamMessage = JSON.parse(data.toString());

      switch (msg.event) {
        case 'start':
          streamSid = msg.start?.streamSid;
          console.log(`[Bridge] Twilio stream started: ${streamSid}`);
          orchestrator.setStreamSid(callSid, streamSid!);

          // Wait a moment for OpenAI to be ready, then trigger greeting
          setTimeout(() => {
            triggerGreeting(callSid);
          }, 500);
          break;

        case 'media':
          if (msg.media?.payload) {
            // Convert Twilio audio to OpenAI format and send
            const openaiAudio = convertTwilioToOpenAI(msg.media.payload);
            sendAudio(callSid, openaiAudio);
          }
          break;

        case 'stop':
          console.log(`[Bridge] Twilio stream stopped`);
          closeSession(callSid);
          orchestrator.endCall(callSid);
          break;
      }
    } catch (err) {
      console.error('[Bridge] Error processing Twilio message:', err);
    }
  });

  twilioWs.on('close', () => {
    console.log(`[Bridge] Twilio WebSocket closed`);
    closeSession(callSid);
    orchestrator.endCall(callSid);

    // Check for pending outbound calls
    const pending = orchestrator.consumePendingOutbound();
    if (pending) {
      console.log(`[Bridge] Initiating pending outbound call to ${pending.target}`);
      initiateOutboundCall(pending.phone, pending.target, pending.reason).catch((err) => {
        console.error('[Bridge] Failed to initiate outbound call:', err);
      });
    }
  });

  twilioWs.on('error', (err) => {
    console.error(`[Bridge] Twilio WebSocket error:`, err);
  });
}

async function handleFunctionCall(
  callSid: string,
  name: string,
  callId: string,
  argsJson: string,
  twilioWs: WebSocket
): Promise<void> {
  console.log(`[Bridge] Function call: ${name}(${argsJson})`);

  let result: unknown;

  try {
    const args = JSON.parse(argsJson);

    switch (name) {
      case 'get_vehicle_status': {
        const vehicleName = args.vehicle || '';

        // Try to find driver by name first
        let vehicle = vehicleName;
        const driver = findDriverByName(vehicleName);
        if (driver) {
          vehicle = driver.vehicle;
        }

        const status = await getVehicleStatus(vehicle);
        if (status) {
          // Calculate stopped duration
          let stoppedMinutes: number | undefined;
          if (status.currentStateDuration && !status.isDriving) {
            const match = status.currentStateDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
              stoppedMinutes =
                (parseInt(match[1] || '0') * 60) + parseInt(match[2] || '0') + parseInt(match[3] || '0') / 60;
            }
          }

          // Save to context
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
        const target = args.target || '';
        const reason = args.reason || '';
        const context = args.context || '';

        let phone: string;
        let targetRole: 'boss' | 'driver' = 'driver';

        if (target.toLowerCase() === 'boss') {
          phone = bossPhone;
          targetRole = 'boss';
        } else {
          const driver = findDriverByName(target);
          if (driver) {
            phone = driver.phone;
          } else {
            result = { error: `Driver "${target}" not found` };
            break;
          }
        }

        // Schedule the outbound call
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
        const summary = args.summary || '';
        orchestrator.endCall(callSid, summary);

        // Send clear message to Twilio to hang up
        twilioWs.send(JSON.stringify({ event: 'clear', streamSid: getSession(callSid)?.streamSid }));

        result = { status: 'ending', summary };
        break;
      }

      case 'save_context': {
        if (args.boss_asked_about || args.vehicle || args.deadline) {
          contextStore.setBossQuery({
            askedAbout: args.boss_asked_about,
            vehicle: args.vehicle,
            deadline: args.deadline,
          });
        }
        if (args.driver_said || args.driver_commitment) {
          contextStore.setDriverResponse({
            said: args.driver_said,
            commitment: args.driver_commitment,
          });
        }
        if (args.diplomatic_response) {
          contextStore.setDiplomaticResponse({
            forBoss: args.diplomatic_response,
          });
        }
        result = { status: 'saved' };
        break;
      }

      default:
        result = { error: `Unknown function: ${name}` };
    }
  } catch (err) {
    console.error(`[Bridge] Error in function ${name}:`, err);
    result = { error: String(err) };
  }

  // Send result back to OpenAI
  sendFunctionResult(callSid, callId, result);
}
