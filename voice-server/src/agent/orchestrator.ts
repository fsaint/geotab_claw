import { contextStore, CallContext } from './context';
import { PersonaType } from './personas';

export type CallState =
  | 'IDLE'
  | 'INBOUND_BOSS'
  | 'CHECKING_FLEET'
  | 'CALLING_DRIVER'
  | 'TALKING_TO_DRIVER'
  | 'CALLING_BOSS_BACK'
  | 'OUTBOUND_ACTIVE';

export interface ActiveCall {
  callSid: string;
  streamSid?: string;
  direction: 'inbound' | 'outbound';
  callerPhone: string;
  callerRole: 'boss' | 'driver' | 'unknown';
  callerName: string;
  personaType: PersonaType;
  startTime: Date;
}

class CallOrchestrator {
  private state: CallState = 'IDLE';
  private activeCalls: Map<string, ActiveCall> = new Map();
  private pendingOutbound: {
    target: string;
    phone: string;
    reason: string;
    context: string;
  } | null = null;

  getState(): CallState {
    return this.state;
  }

  setState(newState: CallState): void {
    console.log(`[Orchestrator] State: ${this.state} -> ${newState}`);
    this.state = newState;
  }

  startCall(call: ActiveCall): void {
    this.activeCalls.set(call.callSid, call);

    // Update state based on call type
    if (call.direction === 'inbound') {
      if (call.callerRole === 'boss') {
        this.setState('INBOUND_BOSS');
      }
    } else {
      if (call.callerRole === 'driver') {
        this.setState('TALKING_TO_DRIVER');
      } else if (call.callerRole === 'boss') {
        this.setState('CALLING_BOSS_BACK');
      }
    }

    // Add to context
    const ctx: CallContext = {
      callSid: call.callSid,
      callerPhone: call.callerPhone,
      callerRole: call.callerRole,
      callerName: call.callerName,
      startTime: call.startTime,
    };
    contextStore.addCall(ctx);
  }

  endCall(callSid: string, summary?: string): void {
    const call = this.activeCalls.get(callSid);
    if (call) {
      this.activeCalls.delete(callSid);
      contextStore.endCall(callSid, summary);
    }

    // If no more active calls, return to IDLE
    if (this.activeCalls.size === 0) {
      this.setState('IDLE');
    }
  }

  getActiveCall(callSid: string): ActiveCall | undefined {
    return this.activeCalls.get(callSid);
  }

  getActiveCallByStream(streamSid: string): ActiveCall | undefined {
    for (const call of this.activeCalls.values()) {
      if (call.streamSid === streamSid) {
        return call;
      }
    }
    return undefined;
  }

  setStreamSid(callSid: string, streamSid: string): void {
    const call = this.activeCalls.get(callSid);
    if (call) {
      call.streamSid = streamSid;
    }
  }

  hasActiveCalls(): boolean {
    return this.activeCalls.size > 0;
  }

  getActiveCalls(): ActiveCall[] {
    return Array.from(this.activeCalls.values());
  }

  // Schedule an outbound call (to be executed after current call ends or immediately)
  scheduleOutbound(target: string, phone: string, reason: string, context: string): void {
    this.pendingOutbound = { target, phone, reason, context };
    console.log(`[Orchestrator] Scheduled outbound call to ${target}`);
  }

  // Get and clear pending outbound call
  consumePendingOutbound(): typeof this.pendingOutbound {
    const pending = this.pendingOutbound;
    this.pendingOutbound = null;
    return pending;
  }

  hasPendingOutbound(): boolean {
    return this.pendingOutbound !== null;
  }

  // Reset everything (for demo restart)
  reset(): void {
    this.state = 'IDLE';
    this.activeCalls.clear();
    this.pendingOutbound = null;
    contextStore.reset();
    console.log('[Orchestrator] Reset complete');
  }
}

// Singleton instance
export const orchestrator = new CallOrchestrator();
