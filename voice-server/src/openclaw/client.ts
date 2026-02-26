/**
 * OpenClaw Gateway WebSocket Client
 *
 * Implements the actual OpenClaw Gateway protocol:
 * 1. Connect to WebSocket
 * 2. Wait for connect.challenge event
 * 3. Send connect request
 * 4. Receive hello-ok response
 * 5. Use chat.send for conversations
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { config } from '../config';
import {
  PROTOCOL_VERSION,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  ConnectParams,
  HelloOk,
  ChatSendParams,
  ChatEvent,
  PendingRequest,
  ErrorShape,
} from './types';

export interface OpenClawClientConfig {
  url: string;
  token?: string;
  clientId: string;
  clientVersion: string;
  reconnectAttempts: number;
  reconnectDelay: number;
}

const DEFAULT_CONFIG: OpenClawClientConfig = {
  url: 'ws://127.0.0.1:18789',
  clientId: 'voice-server',
  clientVersion: '1.0.0',
  reconnectAttempts: 3,
  reconnectDelay: 1000,
};

export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: OpenClawClientConfig;
  private pending = new Map<string, PendingRequest>();
  private reconnectCount = 0;
  private closed = false;
  private isConnecting = false;
  private helloOk: HelloOk | null = null;
  private connectNonce: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastTick: number = Date.now();
  private tickIntervalMs = 30000;

  constructor(cfg: Partial<OpenClawClientConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      url: config.openclaw?.gatewayUrl || DEFAULT_CONFIG.url,
      token: config.openclaw?.gatewayToken || undefined,
      ...cfg,
    };
  }

  /**
   * Connect to OpenClaw Gateway
   */
  async connect(): Promise<HelloOk> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.helloOk) {
      return this.helloOk;
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const onConnected = (hello: HelloOk) => {
          this.off('error', onError);
          resolve(hello);
        };
        const onError = (err: ErrorShape) => {
          this.off('connected', onConnected);
          reject(new Error(err.message));
        };
        this.once('connected', onConnected);
        this.once('error', onError);
      });
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        console.log(`[OpenClaw] Connecting to ${this.config.url}`);
        this.ws = new WebSocket(this.config.url, {
          maxPayload: 25 * 1024 * 1024,
        });

        this.ws.on('open', () => {
          console.log('[OpenClaw] WebSocket connected, waiting for challenge...');
          // Don't send connect yet - wait for connect.challenge event
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (err) => {
          console.error('[OpenClaw] WebSocket error:', err);
          if (this.isConnecting) {
            this.isConnecting = false;
            reject(err);
          }
          this.emit('error', { code: 'connection_error', message: err.message });
        });

        this.ws.on('close', (code, reason) => {
          const reasonStr = reason.toString();
          console.log(`[OpenClaw] WebSocket closed: ${code} ${reasonStr}`);
          this.isConnecting = false;
          this.helloOk = null;
          this.stopTickWatch();
          this.flushPendingErrors(new Error(`Connection closed: ${code}`));
          this.emit('disconnected', { code, reason: reasonStr });
          this.attemptReconnect();
        });

        // Set up one-time handler for successful connection
        const onConnected = (hello: HelloOk) => {
          this.isConnecting = false;
          this.reconnectCount = 0;
          resolve(hello);
        };
        this.once('connected', onConnected);

      } catch (err) {
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  /**
   * Disconnect from gateway
   */
  disconnect(): void {
    this.closed = true;
    this.stopTickWatch();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.helloOk = null;
    this.flushPendingErrors(new Error('Client disconnected'));
  }

  /**
   * Send a chat message
   */
  async chatSend(sessionKey: string, message: string): Promise<void> {
    const params: ChatSendParams = {
      sessionKey,
      message,
      idempotencyKey: randomUUID(),
    };

    // chat.send returns immediately with { status: 'accepted' }
    // Actual responses come as chat events
    await this.request('chat.send', params);
  }

  /**
   * Abort a chat response
   */
  async chatAbort(sessionKey: string, runId?: string): Promise<void> {
    await this.request('chat.abort', { sessionKey, runId });
  }

  /**
   * Inject a system message into a session
   */
  async chatInject(sessionKey: string, message: string, label?: string): Promise<void> {
    await this.request('chat.inject', { sessionKey, message, label });
  }

  /**
   * Patch session settings (e.g., system prompt)
   */
  async sessionsPatch(sessionKey: string, systemPrompt?: string): Promise<void> {
    await this.request('sessions.patch', { sessionKey, systemPrompt });
  }

  /**
   * List available sessions
   */
  async sessionsList(): Promise<unknown> {
    return await this.request('sessions.list', {});
  }

  /**
   * List available agents
   */
  async agentsList(): Promise<unknown> {
    return await this.request('agents.list', {});
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.helloOk !== null;
  }

  /**
   * Get connection info
   */
  getHelloOk(): HelloOk | null {
    return this.helloOk;
  }

  // === Private Methods ===

  private handleMessage(raw: string): void {
    try {
      const frame = JSON.parse(raw);

      if (frame.type === 'event') {
        this.handleEvent(frame as EventFrame);
      } else if (frame.type === 'res') {
        this.handleResponse(frame as ResponseFrame);
      }
    } catch (err) {
      console.error('[OpenClaw] Failed to parse message:', err);
    }
  }

  private handleEvent(event: EventFrame): void {
    switch (event.event) {
      case 'connect.challenge':
        // Gateway is challenging us - extract nonce and send connect
        const payload = event.payload as { nonce?: string } | undefined;
        this.connectNonce = payload?.nonce || null;
        this.sendConnect();
        break;

      case 'tick':
        this.lastTick = Date.now();
        this.emit('tick', event.payload);
        break;

      case 'chat':
        // Chat event with streaming response
        const chatEvent = event.payload as ChatEvent;
        this.emit('chat', chatEvent);
        break;

      case 'shutdown':
        console.log('[OpenClaw] Server shutting down:', event.payload);
        break;

      default:
        // Forward other events
        this.emit(event.event, event.payload);
    }
  }

  private handleResponse(response: ResponseFrame): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    // Check if this is an intermediate ack (status: accepted)
    const payload = response.payload as { status?: string } | undefined;
    if (payload?.status === 'accepted') {
      // Keep waiting for final response or events
      return;
    }

    this.pending.delete(response.id);

    if (response.ok) {
      // Check if this is hello-ok
      const helloPayload = response.payload as { type?: string };
      if (helloPayload?.type === 'hello-ok') {
        this.helloOk = response.payload as HelloOk;
        this.tickIntervalMs = this.helloOk.policy?.tickIntervalMs || 30000;
        this.startTickWatch();
        console.log(`[OpenClaw] Connected to server ${this.helloOk.server.version}`);
        this.emit('connected', this.helloOk);
      }
      pending.resolve(response.payload);
    } else {
      const errMsg = response.error?.message || 'Unknown error';
      pending.reject(new Error(errMsg));
    }
  }

  private sendConnect(): void {
    const params: ConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: this.config.clientId,
        version: this.config.clientVersion,
        platform: process.platform,
        mode: 'backend',
        instanceId: randomUUID(),
      },
      caps: [],
      role: 'operator',
      scopes: ['operator.admin'],
      auth: this.config.token ? { token: this.config.token } : undefined,
    };

    this.request<HelloOk>('connect', params)
      .then((hello) => {
        // Response handled in handleResponse
      })
      .catch((err) => {
        console.error('[OpenClaw] Connect failed:', err);
        this.emit('error', { code: 'connect_failed', message: err.message });
        this.ws?.close(1008, 'connect failed');
      });
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = randomUUID();
    const frame: RequestFrame = {
      type: 'req',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        method,
      });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  private flushPendingErrors(err: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(err);
    }
    this.pending.clear();
  }

  private startTickWatch(): void {
    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => {
      const gap = Date.now() - this.lastTick;
      if (gap > this.tickIntervalMs * 2) {
        console.warn('[OpenClaw] Tick timeout, closing connection');
        this.ws?.close(4000, 'tick timeout');
      }
    }, this.tickIntervalMs);
  }

  private stopTickWatch(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (this.closed) {
      return;
    }

    if (this.reconnectCount >= this.config.reconnectAttempts) {
      console.log('[OpenClaw] Max reconnect attempts reached');
      return;
    }

    this.reconnectCount++;
    const delay = this.config.reconnectDelay * this.reconnectCount;
    console.log(`[OpenClaw] Reconnecting in ${delay}ms (attempt ${this.reconnectCount})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[OpenClaw] Reconnect failed:', err);
      });
    }, delay);
  }
}

// Singleton instance
let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    clientInstance = new OpenClawClient();
  }
  return clientInstance;
}
