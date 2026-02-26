/**
 * OpenClaw Gateway Protocol Types
 *
 * Message types for communicating with the OpenClaw WebSocket Gateway.
 */

// === Connection & Session Messages ===

export interface OpenClawHandshake {
  type: 'handshake';
  token?: string;
  clientId: string;
  version: string;
}

export interface OpenClawHandshakeAck {
  type: 'handshake.ack';
  sessionId: string;
  status: 'connected';
}

export interface OpenClawSessionCreate {
  type: 'session.create';
  sessionId: string;
  systemPrompt?: string;
  tools?: OpenClawTool[];
}

export interface OpenClawSessionCreated {
  type: 'session.created';
  sessionId: string;
  conversationId: string;
}

export interface OpenClawSessionEnd {
  type: 'session.end';
  sessionId: string;
}

// === Message Types ===

export interface OpenClawUserMessage {
  type: 'message.user';
  sessionId: string;
  content: string;
  messageId?: string;
}

export interface OpenClawAssistantMessage {
  type: 'message.assistant';
  sessionId: string;
  content: string;
  messageId: string;
  isComplete: boolean;
}

export interface OpenClawAssistantDelta {
  type: 'message.assistant.delta';
  sessionId: string;
  delta: string;
  messageId: string;
}

export interface OpenClawMessageComplete {
  type: 'message.complete';
  sessionId: string;
  messageId: string;
  content: string;
}

// === Tool Calls ===

export interface OpenClawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface OpenClawToolCall {
  type: 'tool.call';
  sessionId: string;
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface OpenClawToolResult {
  type: 'tool.result';
  sessionId: string;
  toolCallId: string;
  result: unknown;
  isError?: boolean;
}

// === Error & Control ===

export interface OpenClawError {
  type: 'error';
  sessionId?: string;
  code: string;
  message: string;
}

export interface OpenClawPing {
  type: 'ping';
}

export interface OpenClawPong {
  type: 'pong';
}

// === Union Types ===

export type OpenClawClientMessage =
  | OpenClawHandshake
  | OpenClawSessionCreate
  | OpenClawSessionEnd
  | OpenClawUserMessage
  | OpenClawToolResult
  | OpenClawPing;

export type OpenClawServerMessage =
  | OpenClawHandshakeAck
  | OpenClawSessionCreated
  | OpenClawAssistantMessage
  | OpenClawAssistantDelta
  | OpenClawMessageComplete
  | OpenClawToolCall
  | OpenClawError
  | OpenClawPong;

// === Event Handlers ===

export type OpenClawEventType =
  | 'connected'
  | 'disconnected'
  | 'session.created'
  | 'message.delta'
  | 'message.complete'
  | 'tool.call'
  | 'error';

export interface OpenClawEventMap {
  connected: { sessionId: string };
  disconnected: { reason?: string };
  'session.created': { sessionId: string; conversationId: string };
  'message.delta': { delta: string; messageId: string };
  'message.complete': { content: string; messageId: string };
  'tool.call': { toolCallId: string; name: string; arguments: Record<string, unknown> };
  error: { code: string; message: string };
}

export type OpenClawEventHandler<T extends OpenClawEventType> = (
  event: OpenClawEventMap[T]
) => void;
