/**
 * OpenClaw Gateway Protocol Types
 *
 * Matches the actual OpenClaw WebSocket Gateway protocol.
 * See: openclaw/src/gateway/protocol/schema/
 */

// === Protocol Version ===
export const PROTOCOL_VERSION = 1;

// === Frame Types ===

export interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

export interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

export interface ErrorShape {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
}

export type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

// === Connect ===

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    displayName?: string;
    version: string;
    platform: string;
    mode: 'backend' | 'operator' | 'probe';
    instanceId?: string;
  };
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  role?: string;
  scopes?: string[];
  auth?: {
    token?: string;
    password?: string;
  };
}

export interface HelloOk {
  type: 'hello-ok';
  protocol: number;
  server: {
    version: string;
    commit?: string;
    host?: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: Snapshot;
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

export interface Snapshot {
  sessions?: SessionSummary[];
  agents?: AgentSummary[];
  // ... other snapshot fields
}

export interface SessionSummary {
  key: string;
  agent?: string;
  title?: string;
  updatedAt?: number;
}

export interface AgentSummary {
  id: string;
  name?: string;
}

// === Chat ===

export interface ChatSendParams {
  sessionKey: string;
  message: string;
  thinking?: string;
  deliver?: boolean;
  attachments?: unknown[];
  timeoutMs?: number;
  idempotencyKey: string;
}

export interface ChatAbortParams {
  sessionKey: string;
  runId?: string;
}

export interface ChatInjectParams {
  sessionKey: string;
  message: string;
  label?: string;
}

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: ChatMessage;
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
}

export interface ChatMessage {
  role?: 'user' | 'assistant';
  content?: ContentBlock[];
  // For deltas, may just have text
  text?: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

// === Sessions ===

export interface SessionsListParams {
  limit?: number;
  cursor?: string;
}

export interface SessionsResolveParams {
  sessionKey: string;
}

export interface SessionsPatchParams {
  sessionKey: string;
  systemPrompt?: string;
  title?: string;
}

// === Agents ===

export interface AgentsListParams {
  // empty
}

// === Tick Event ===

export interface TickEvent {
  ts: number;
}

// === Helper Types ===

export type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
};

export interface GatewayClientEvents {
  connected: HelloOk;
  disconnected: { code: number; reason: string };
  chat: ChatEvent;
  tick: TickEvent;
  error: ErrorShape;
}
