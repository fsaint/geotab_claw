/**
 * OpenClaw Gateway WebSocket Client
 *
 * Manages WebSocket connection to the OpenClaw Gateway for Claude-powered
 * conversations with Geotab MCP tools.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config';
import {
  OpenClawClientMessage,
  OpenClawServerMessage,
  OpenClawEventType,
  OpenClawEventHandler,
  OpenClawTool,
  OpenClawHandshake,
  OpenClawSessionCreate,
  OpenClawUserMessage,
  OpenClawToolResult,
  OpenClawSessionEnd,
} from './types';

export interface OpenClawClientConfig {
  gatewayUrl: string;
  token?: string;
  reconnectAttempts: number;
  reconnectDelay: number;
  pingInterval: number;
}

const DEFAULT_CONFIG: OpenClawClientConfig = {
  gatewayUrl: 'ws://localhost:18789',
  reconnectAttempts: 3,
  reconnectDelay: 1000,
  pingInterval: 30000,
};

export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: OpenClawClientConfig;
  private clientId: string;
  private sessionId: string | null = null;
  private reconnectCount = 0;
  private pingTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private messageQueue: OpenClawClientMessage[] = [];

  constructor(cfg: Partial<OpenClawClientConfig> = {}) {
    super();
    this.config = {
      ...DEFAULT_CONFIG,
      gatewayUrl: config.openclaw?.gatewayUrl || DEFAULT_CONFIG.gatewayUrl,
      token: config.openclaw?.gatewayToken,
      ...cfg,
    };
    this.clientId = `voice-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Connect to OpenClaw Gateway
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        console.log(`[OpenClaw] Connecting to ${this.config.gatewayUrl}`);
        this.ws = new WebSocket(this.config.gatewayUrl);

        this.ws.on('open', () => {
          console.log('[OpenClaw] WebSocket connected');
          this.isConnecting = false;
          this.reconnectCount = 0;

          // Send handshake
          this.sendHandshake();
          this.startPing();

          // Process queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            if (msg) this.send(msg);
          }

          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (err) => {
          console.error('[OpenClaw] WebSocket error:', err);
          this.emitEvent('error', { code: 'connection_error', message: err.message });
          if (this.isConnecting) {
            reject(err);
          }
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[OpenClaw] WebSocket closed: ${code} ${reason}`);
          this.isConnecting = false;
          this.stopPing();
          this.emitEvent('disconnected', { reason: reason.toString() });
          this.attemptReconnect();
        });
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
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.sessionId = null;
  }

  /**
   * Create a new conversation session
   */
  createSession(systemPrompt?: string, tools?: OpenClawTool[]): void {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const msg: OpenClawSessionCreate = {
      type: 'session.create',
      sessionId,
      systemPrompt,
      tools,
    };

    this.send(msg);
  }

  /**
   * Send a user message
   */
  sendUserMessage(content: string, messageId?: string): void {
    if (!this.sessionId) {
      console.error('[OpenClaw] No active session');
      return;
    }

    const msg: OpenClawUserMessage = {
      type: 'message.user',
      sessionId: this.sessionId,
      content,
      messageId: messageId || `msg-${Date.now()}`,
    };

    this.send(msg);
  }

  /**
   * Send tool result back to gateway
   */
  sendToolResult(toolCallId: string, result: unknown, isError = false): void {
    if (!this.sessionId) {
      console.error('[OpenClaw] No active session');
      return;
    }

    const msg: OpenClawToolResult = {
      type: 'tool.result',
      sessionId: this.sessionId,
      toolCallId,
      result,
      isError,
    };

    this.send(msg);
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (!this.sessionId) {
      return;
    }

    const msg: OpenClawSessionEnd = {
      type: 'session.end',
      sessionId: this.sessionId,
    };

    this.send(msg);
    this.sessionId = null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Check if session is active
   */
  hasActiveSession(): boolean {
    return this.sessionId !== null;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Register event handler
   */
  onEvent<T extends OpenClawEventType>(event: T, handler: OpenClawEventHandler<T>): void {
    this.on(event, handler);
  }

  /**
   * Remove event handler
   */
  offEvent<T extends OpenClawEventType>(event: T, handler: OpenClawEventHandler<T>): void {
    this.off(event, handler);
  }

  // === Private Methods ===

  private send(msg: OpenClawClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue message if not connected
      this.messageQueue.push(msg);
      return;
    }

    this.ws.send(JSON.stringify(msg));
  }

  private sendHandshake(): void {
    const handshake: OpenClawHandshake = {
      type: 'handshake',
      clientId: this.clientId,
      token: this.config.token,
      version: '1.0.0',
    };

    this.send(handshake);
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const msg: OpenClawServerMessage = JSON.parse(data.toString());

      switch (msg.type) {
        case 'handshake.ack':
          console.log(`[OpenClaw] Handshake acknowledged, sessionId: ${msg.sessionId}`);
          this.emitEvent('connected', { sessionId: msg.sessionId });
          break;

        case 'session.created':
          this.sessionId = msg.sessionId;
          console.log(`[OpenClaw] Session created: ${msg.sessionId}`);
          this.emitEvent('session.created', {
            sessionId: msg.sessionId,
            conversationId: msg.conversationId,
          });
          break;

        case 'message.assistant.delta':
          this.emitEvent('message.delta', {
            delta: msg.delta,
            messageId: msg.messageId,
          });
          break;

        case 'message.complete':
          this.emitEvent('message.complete', {
            content: msg.content,
            messageId: msg.messageId,
          });
          break;

        case 'tool.call':
          console.log(`[OpenClaw] Tool call: ${msg.name}`);
          this.emitEvent('tool.call', {
            toolCallId: msg.toolCallId,
            name: msg.name,
            arguments: msg.arguments,
          });
          break;

        case 'error':
          console.error(`[OpenClaw] Error: ${msg.code} - ${msg.message}`);
          this.emitEvent('error', { code: msg.code, message: msg.message });
          break;

        case 'pong':
          // Heartbeat response, ignore
          break;

        default:
          console.log(`[OpenClaw] Unknown message type:`, (msg as { type: string }).type);
      }
    } catch (err) {
      console.error('[OpenClaw] Failed to parse message:', err);
    }
  }

  private emitEvent<T extends OpenClawEventType>(
    event: T,
    data: Parameters<OpenClawEventHandler<T>>[0]
  ): void {
    this.emit(event, data);
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, this.config.pingInterval);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private attemptReconnect(): void {
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

/**
 * Create a singleton OpenClaw client instance
 */
let clientInstance: OpenClawClient | null = null;

export function getOpenClawClient(): OpenClawClient {
  if (!clientInstance) {
    clientInstance = new OpenClawClient();
  }
  return clientInstance;
}
