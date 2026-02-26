/**
 * OpenClaw Session Manager
 *
 * Manages conversation sessions between voice calls and OpenClaw Gateway.
 * Uses the actual OpenClaw protocol with sessionKey-based sessions.
 */

import { getOpenClawClient, OpenClawClient } from './client';
import { ChatEvent, ChatMessage, ContentBlock, HelloOk } from './types';
import { PersonaType, getPersona } from '../agent/personas';
import { Driver } from '../contacts/drivers';

export interface OpenClawSession {
  callSid: string;
  sessionKey: string;
  personaType: PersonaType;
  driver?: Driver;
  client: OpenClawClient;
  isReady: boolean;
  currentRunId: string | null;
  pendingText: string;
  onTextDelta?: (text: string) => void;
  onTextComplete?: (text: string) => void;
  onToolCall?: (toolId: string, name: string, input: Record<string, unknown>) => void;
  onError?: (error: { code: string; message: string }) => void;
}

// Active sessions indexed by callSid
const sessions = new Map<string, OpenClawSession>();

// Map sessionKey back to callSid for event routing
const sessionKeyToCallSid = new Map<string, string>();

/**
 * Create a new OpenClaw session for a call
 */
export async function createOpenClawSession(
  callSid: string,
  personaType: PersonaType,
  driver?: Driver
): Promise<OpenClawSession> {
  const client = getOpenClawClient();

  // Connect if needed
  let helloOk: HelloOk;
  try {
    helloOk = await client.connect();
  } catch (err) {
    console.error('[OpenClawSession] Failed to connect:', err);
    throw err;
  }

  // Generate a unique session key for this call
  const sessionKey = `voice-${callSid}-${Date.now()}`;

  const session: OpenClawSession = {
    callSid,
    sessionKey,
    personaType,
    driver,
    client,
    isReady: false,
    currentRunId: null,
    pendingText: '',
  };

  // Register session
  sessions.set(callSid, session);
  sessionKeyToCallSid.set(sessionKey, callSid);

  // Set up chat event handler for this session
  const handleChatEvent = (event: ChatEvent) => {
    // Only handle events for our session
    if (event.sessionKey !== sessionKey) {
      return;
    }

    session.currentRunId = event.runId;

    switch (event.state) {
      case 'delta':
        handleDelta(session, event);
        break;

      case 'final':
        handleFinal(session, event);
        break;

      case 'error':
        console.error(`[OpenClawSession] Error in ${callSid}:`, event.errorMessage);
        if (session.onError) {
          session.onError({ code: 'chat_error', message: event.errorMessage || 'Unknown error' });
        }
        break;

      case 'aborted':
        console.log(`[OpenClawSession] Response aborted for ${callSid}`);
        session.pendingText = '';
        break;
    }
  };

  client.on('chat', handleChatEvent);

  // Inject the persona as system context
  try {
    const systemPrompt = getPersona(personaType, driver);
    await client.chatInject(sessionKey, systemPrompt, 'system-persona');
    session.isReady = true;
    console.log(`[OpenClawSession] Session ready: ${sessionKey}`);
  } catch (err) {
    console.error('[OpenClawSession] Failed to inject persona:', err);
    // Session may still work, just without custom persona
    session.isReady = true;
  }

  return session;
}

/**
 * Handle delta (streaming) events
 */
function handleDelta(session: OpenClawSession, event: ChatEvent): void {
  const message = event.message;
  if (!message) return;

  // Check for text content
  if (typeof message === 'object' && 'content' in message) {
    const chatMessage = message as ChatMessage;
    if (chatMessage.content) {
      for (const block of chatMessage.content) {
        if (block.type === 'text' && block.text) {
          session.pendingText += block.text;
          if (session.onTextDelta) {
            session.onTextDelta(block.text);
          }
        }
      }
    }
  }

  // Some deltas may have text directly
  if (typeof message === 'object' && 'text' in message) {
    const text = (message as { text?: string }).text;
    if (text) {
      session.pendingText += text;
      if (session.onTextDelta) {
        session.onTextDelta(text);
      }
    }
  }
}

/**
 * Handle final (complete) events
 */
function handleFinal(session: OpenClawSession, event: ChatEvent): void {
  const message = event.message;

  if (message && typeof message === 'object' && 'content' in message) {
    const chatMessage = message as ChatMessage;
    if (chatMessage.content) {
      let fullText = '';

      for (const block of chatMessage.content) {
        if (block.type === 'text') {
          fullText += block.text;
        } else if (block.type === 'tool_use') {
          // Tool call from Claude
          console.log(`[OpenClawSession] Tool call: ${block.name}`);
          if (session.onToolCall) {
            session.onToolCall(block.id, block.name, block.input);
          }
        }
      }

      if (fullText && session.onTextComplete) {
        session.onTextComplete(fullText);
      }
    }
  }

  // Clear pending text
  session.pendingText = '';
  session.currentRunId = null;
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
export async function sendTranscription(callSid: string, text: string): Promise<void> {
  const session = sessions.get(callSid);
  if (!session || !session.isReady) {
    console.error(`[OpenClawSession] No ready session for call ${callSid}`);
    return;
  }

  console.log(`[OpenClawSession] Sending: "${text}"`);

  try {
    await session.client.chatSend(session.sessionKey, text);
  } catch (err) {
    console.error('[OpenClawSession] Failed to send message:', err);
  }
}

/**
 * Send tool result back to OpenClaw
 * Note: In the actual OpenClaw protocol, tool results are handled differently.
 * The MCP server handles tools directly, not the voice client.
 */
export async function sendToolResult(
  callSid: string,
  toolId: string,
  result: unknown,
  isError = false
): Promise<void> {
  const session = sessions.get(callSid);
  if (!session) {
    console.error(`[OpenClawSession] No session for call ${callSid}`);
    return;
  }

  // In OpenClaw, tool results are typically handled by MCP nodes.
  // For voice, we inject the result as a follow-up message.
  const resultText = isError
    ? `Tool error: ${JSON.stringify(result)}`
    : `Tool result: ${JSON.stringify(result)}`;

  try {
    await session.client.chatInject(session.sessionKey, resultText, 'tool-result');
  } catch (err) {
    console.error('[OpenClawSession] Failed to inject tool result:', err);
  }
}

/**
 * Trigger initial greeting
 */
export async function triggerGreeting(callSid: string): Promise<void> {
  const session = sessions.get(callSid);
  if (!session || !session.isReady) {
    console.error(`[OpenClawSession] No ready session for call ${callSid}`);
    return;
  }

  try {
    await session.client.chatSend(
      session.sessionKey,
      '[Call connected. Greet the caller naturally as Claw, the fleet dispatch manager.]'
    );
  } catch (err) {
    console.error('[OpenClawSession] Failed to trigger greeting:', err);
  }
}

/**
 * Abort current response (user interrupted)
 */
export async function interruptResponse(callSid: string): Promise<void> {
  const session = sessions.get(callSid);
  if (!session) {
    return;
  }

  session.pendingText = '';

  if (session.currentRunId) {
    try {
      await session.client.chatAbort(session.sessionKey, session.currentRunId);
    } catch (err) {
      console.error('[OpenClawSession] Failed to abort:', err);
    }
  }
}

/**
 * Close session for a call
 */
export function closeOpenClawSession(callSid: string): void {
  const session = sessions.get(callSid);
  if (session) {
    sessionKeyToCallSid.delete(session.sessionKey);
    sessions.delete(callSid);
    console.log(`[OpenClawSession] Session closed for call ${callSid}`);
  }
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): Map<string, OpenClawSession> {
  return sessions;
}
