import WebSocket from 'ws';
import { config } from '../config';
import { getToolsConfig } from './tools';
import { PersonaType, getPersona } from '../agent/personas';
import { Driver } from '../contacts/drivers';

export interface RealtimeSession {
  ws: WebSocket;
  sessionId?: string;
  callSid: string;
  streamSid?: string;
  personaType: PersonaType;
  isReady: boolean;
}

export type RealtimeEventHandler = (event: unknown, session: RealtimeSession) => void;

const sessions = new Map<string, RealtimeSession>();

export function createSession(
  callSid: string,
  personaType: PersonaType,
  driver?: Driver,
  onEvent?: RealtimeEventHandler
): RealtimeSession {
  const url = `${config.openai.realtimeUrl}?model=${config.openai.model}`;

  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  const session: RealtimeSession = {
    ws,
    callSid,
    personaType,
    isReady: false,
  };

  ws.on('open', () => {
    console.log(`[OpenAI] WebSocket connected for call ${callSid}`);

    // Configure the session
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: config.openai.voice,
        instructions: getPersona(personaType, driver),
        tools: getToolsConfig(),
        tool_choice: 'auto',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        temperature: 0.8,
        max_response_output_tokens: 500,
      },
    };

    ws.send(JSON.stringify(sessionConfig));
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const event = JSON.parse(data.toString());

      // Log important events
      if (event.type === 'session.created') {
        session.sessionId = event.session?.id;
        session.isReady = true;
        console.log(`[OpenAI] Session created: ${session.sessionId}`);
      } else if (event.type === 'session.updated') {
        console.log(`[OpenAI] Session configured`);
      } else if (event.type === 'error') {
        console.error(`[OpenAI] Error:`, event.error);
      } else if (event.type === 'response.function_call_arguments.done') {
        console.log(`[OpenAI] Function call: ${event.name}`);
      }

      // Forward event to handler
      if (onEvent) {
        onEvent(event, session);
      }
    } catch (err) {
      console.error('[OpenAI] Failed to parse message:', err);
    }
  });

  ws.on('error', (err) => {
    console.error(`[OpenAI] WebSocket error for call ${callSid}:`, err);
  });

  ws.on('close', (code, reason) => {
    console.log(`[OpenAI] WebSocket closed for call ${callSid}: ${code} ${reason}`);
    sessions.delete(callSid);
  });

  sessions.set(callSid, session);
  return session;
}

export function getSession(callSid: string): RealtimeSession | undefined {
  return sessions.get(callSid);
}

export function closeSession(callSid: string): void {
  const session = sessions.get(callSid);
  if (session) {
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.close();
    }
    sessions.delete(callSid);
  }
}

export function sendAudio(callSid: string, audioBase64: string): void {
  const session = sessions.get(callSid);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: audioBase64,
      })
    );
  }
}

export function commitAudio(callSid: string): void {
  const session = sessions.get(callSid);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(
      JSON.stringify({
        type: 'input_audio_buffer.commit',
      })
    );
  }
}

export function sendFunctionResult(callSid: string, callId: string, result: unknown): void {
  const session = sessions.get(callSid);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(result),
        },
      })
    );

    // Trigger response generation after function result
    session.ws.send(
      JSON.stringify({
        type: 'response.create',
      })
    );
  }
}

export function interruptResponse(callSid: string): void {
  const session = sessions.get(callSid);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(
      JSON.stringify({
        type: 'response.cancel',
      })
    );
  }
}

export function triggerGreeting(callSid: string): void {
  const session = sessions.get(callSid);
  if (session && session.ws.readyState === WebSocket.OPEN) {
    // Send a system message to trigger initial greeting
    session.ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: '[Call connected. Greet the caller naturally as Claw, the fleet dispatch manager.]',
            },
          ],
        },
      })
    );

    session.ws.send(
      JSON.stringify({
        type: 'response.create',
      })
    );
  }
}
