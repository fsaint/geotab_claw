/**
 * OpenClaw Session Manager
 *
 * Manages conversation sessions between voice calls and OpenClaw Gateway.
 * Each phone call gets its own session with persona-specific configuration.
 */

import { getOpenClawClient, OpenClawClient } from './client';
import { OpenClawTool, OpenClawEventMap } from './types';
import { PersonaType, getPersona } from '../agent/personas';
import { Driver } from '../contacts/drivers';

export interface OpenClawSession {
  callSid: string;
  sessionId: string | null;
  personaType: PersonaType;
  driver?: Driver;
  client: OpenClawClient;
  isReady: boolean;
  pendingResponse: string;
  onMessageDelta?: (delta: string) => void;
  onMessageComplete?: (content: string) => void;
  onToolCall?: (toolCallId: string, name: string, args: Record<string, unknown>) => void;
  onError?: (error: { code: string; message: string }) => void;
}

// Active sessions indexed by callSid
const sessions = new Map<string, OpenClawSession>();

// Define tools that OpenClaw should expose to the LLM
const VOICE_TOOLS: OpenClawTool[] = [
  {
    name: 'get_vehicle_status',
    description: 'Get real-time location, speed, and status of a vehicle by name or driver name',
    inputSchema: {
      type: 'object',
      properties: {
        vehicle: {
          type: 'string',
          description: 'Vehicle name or driver name',
        },
      },
      required: ['vehicle'],
    },
  },
  {
    name: 'get_fleet_overview',
    description: 'Get status summary of all vehicles in the fleet',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'initiate_call',
    description: 'Schedule a call to a driver or the boss after this call ends',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Who to call (driver name or "boss")',
        },
        reason: {
          type: 'string',
          description: 'Why are you calling them',
        },
        context: {
          type: 'string',
          description: 'Additional context for the call',
        },
      },
      required: ['target', 'reason'],
    },
  },
  {
    name: 'end_current_call',
    description: 'End the current phone call',
    inputSchema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Brief summary of the call outcome',
        },
      },
    },
  },
  {
    name: 'save_context',
    description: 'Save important context from the conversation for later use',
    inputSchema: {
      type: 'object',
      properties: {
        boss_asked_about: {
          type: 'string',
          description: 'What the boss asked about',
        },
        vehicle: {
          type: 'string',
          description: 'Vehicle being discussed',
        },
        deadline: {
          type: 'string',
          description: 'Any deadline mentioned',
        },
        driver_said: {
          type: 'string',
          description: 'What the driver said',
        },
        driver_commitment: {
          type: 'string',
          description: 'What the driver committed to',
        },
        diplomatic_response: {
          type: 'string',
          description: 'Diplomatic version for reporting to boss',
        },
      },
    },
  },
];

/**
 * Create a new OpenClaw session for a call
 */
export async function createOpenClawSession(
  callSid: string,
  personaType: PersonaType,
  driver?: Driver
): Promise<OpenClawSession> {
  const client = getOpenClawClient();

  // Ensure client is connected
  if (!client.isConnected()) {
    await client.connect();
  }

  const session: OpenClawSession = {
    callSid,
    sessionId: null,
    personaType,
    driver,
    client,
    isReady: false,
    pendingResponse: '',
  };

  // Set up event handlers for this session
  const handleSessionCreated = (event: OpenClawEventMap['session.created']) => {
    session.sessionId = event.sessionId;
    session.isReady = true;
    console.log(`[OpenClawSession] Session ready for call ${callSid}: ${event.sessionId}`);
  };

  const handleMessageDelta = (event: OpenClawEventMap['message.delta']) => {
    session.pendingResponse += event.delta;
    if (session.onMessageDelta) {
      session.onMessageDelta(event.delta);
    }
  };

  const handleMessageComplete = (event: OpenClawEventMap['message.complete']) => {
    session.pendingResponse = '';
    if (session.onMessageComplete) {
      session.onMessageComplete(event.content);
    }
  };

  const handleToolCall = (event: OpenClawEventMap['tool.call']) => {
    if (session.onToolCall) {
      session.onToolCall(event.toolCallId, event.name, event.arguments);
    }
  };

  const handleError = (event: OpenClawEventMap['error']) => {
    console.error(`[OpenClawSession] Error in session ${callSid}:`, event);
    if (session.onError) {
      session.onError(event);
    }
  };

  // Register handlers
  client.onEvent('session.created', handleSessionCreated);
  client.onEvent('message.delta', handleMessageDelta);
  client.onEvent('message.complete', handleMessageComplete);
  client.onEvent('tool.call', handleToolCall);
  client.onEvent('error', handleError);

  // Create session with persona
  const systemPrompt = getPersona(personaType, driver);
  client.createSession(systemPrompt, VOICE_TOOLS);

  // Store session
  sessions.set(callSid, session);

  // Wait for session to be ready (with timeout)
  await waitForSessionReady(session, 5000);

  return session;
}

/**
 * Wait for session to be ready
 */
function waitForSessionReady(session: OpenClawSession, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (session.isReady) {
      resolve();
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      if (session.isReady) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        reject(new Error('Session creation timeout'));
      }
    }, 100);
  });
}

/**
 * Get session by call SID
 */
export function getOpenClawSession(callSid: string): OpenClawSession | undefined {
  return sessions.get(callSid);
}

/**
 * Send user transcription to OpenClaw
 */
export function sendTranscription(callSid: string, text: string): void {
  const session = sessions.get(callSid);
  if (!session || !session.isReady) {
    console.error(`[OpenClawSession] No ready session for call ${callSid}`);
    return;
  }

  console.log(`[OpenClawSession] Sending transcription: "${text}"`);
  session.client.sendUserMessage(text);
}

/**
 * Send tool result back to OpenClaw
 */
export function sendToolResult(callSid: string, toolCallId: string, result: unknown, isError = false): void {
  const session = sessions.get(callSid);
  if (!session) {
    console.error(`[OpenClawSession] No session for call ${callSid}`);
    return;
  }

  session.client.sendToolResult(toolCallId, result, isError);
}

/**
 * Trigger initial greeting
 */
export function triggerGreeting(callSid: string): void {
  const session = sessions.get(callSid);
  if (!session || !session.isReady) {
    console.error(`[OpenClawSession] No ready session for call ${callSid}`);
    return;
  }

  // Send a system trigger to start the conversation
  session.client.sendUserMessage(
    '[Call connected. Greet the caller naturally as Claw, the fleet dispatch manager.]'
  );
}

/**
 * Close session for a call
 */
export function closeOpenClawSession(callSid: string): void {
  const session = sessions.get(callSid);
  if (session) {
    session.client.endSession();
    sessions.delete(callSid);
    console.log(`[OpenClawSession] Session closed for call ${callSid}`);
  }
}

/**
 * Interrupt current response (user started speaking)
 */
export function interruptResponse(callSid: string): void {
  const session = sessions.get(callSid);
  if (session) {
    // Clear pending response
    session.pendingResponse = '';
    // Note: OpenClaw Gateway should handle interruption automatically
    // by stopping the current response when new user input arrives
  }
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): Map<string, OpenClawSession> {
  return sessions;
}
