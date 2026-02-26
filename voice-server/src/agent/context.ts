/**
 * Cross-call memory store for maintaining context between calls
 */

export interface CallContext {
  callSid: string;
  callerPhone: string;
  callerRole: 'boss' | 'driver' | 'unknown';
  callerName: string;
  startTime: Date;
  endTime?: Date;
  summary?: string;
}

export interface ConversationContext {
  // What the boss asked about
  bossAskedAbout?: string;
  bossVehicle?: string;
  bossDeadline?: string;
  bossConcerns?: string[];

  // What we found
  vehicleStatus?: {
    vehicle: string;
    speed: number;
    stoppedMinutes?: number;
    location?: string;
    isDriving: boolean;
  };

  // What the driver said
  driverSaid?: string;
  driverExcuse?: string;
  driverCommitment?: string;

  // Our diplomatic response
  diplomaticResponse?: string;
  whatToTellBoss?: string;

  // Call chain
  callChain: CallContext[];
}

class ContextStore {
  private context: ConversationContext = {
    callChain: [],
  };

  reset(): void {
    this.context = { callChain: [] };
  }

  get(): ConversationContext {
    return this.context;
  }

  setBossQuery(query: {
    askedAbout?: string;
    vehicle?: string;
    deadline?: string;
    concerns?: string[];
  }): void {
    if (query.askedAbout) this.context.bossAskedAbout = query.askedAbout;
    if (query.vehicle) this.context.bossVehicle = query.vehicle;
    if (query.deadline) this.context.bossDeadline = query.deadline;
    if (query.concerns) this.context.bossConcerns = query.concerns;
  }

  setVehicleStatus(status: {
    vehicle: string;
    speed: number;
    stoppedMinutes?: number;
    location?: string;
    isDriving: boolean;
  }): void {
    this.context.vehicleStatus = status;
  }

  setDriverResponse(response: {
    said?: string;
    excuse?: string;
    commitment?: string;
  }): void {
    if (response.said) this.context.driverSaid = response.said;
    if (response.excuse) this.context.driverExcuse = response.excuse;
    if (response.commitment) this.context.driverCommitment = response.commitment;
  }

  setDiplomaticResponse(response: {
    forDriver?: string;
    forBoss?: string;
  }): void {
    if (response.forDriver) this.context.diplomaticResponse = response.forDriver;
    if (response.forBoss) this.context.whatToTellBoss = response.forBoss;
  }

  addCall(call: CallContext): void {
    this.context.callChain.push(call);
  }

  endCall(callSid: string, summary?: string): void {
    const call = this.context.callChain.find((c) => c.callSid === callSid);
    if (call) {
      call.endTime = new Date();
      if (summary) call.summary = summary;
    }
  }

  getLastCall(): CallContext | undefined {
    return this.context.callChain[this.context.callChain.length - 1];
  }

  getCallsCount(): number {
    return this.context.callChain.length;
  }

  /**
   * Generate context summary for injection into prompts
   */
  getSummaryForPrompt(): string {
    const parts: string[] = [];

    if (this.context.bossAskedAbout) {
      parts.push(`Boss asked about: ${this.context.bossAskedAbout}`);
    }
    if (this.context.bossVehicle) {
      parts.push(`Vehicle in question: ${this.context.bossVehicle}`);
    }
    if (this.context.bossDeadline) {
      parts.push(`Deadline mentioned: ${this.context.bossDeadline}`);
    }
    if (this.context.vehicleStatus) {
      const vs = this.context.vehicleStatus;
      parts.push(
        `Vehicle status: ${vs.vehicle} - ${vs.isDriving ? 'driving' : 'stopped'}, speed: ${vs.speed} mph${
          vs.stoppedMinutes ? `, stopped for ${vs.stoppedMinutes} min` : ''
        }${vs.location ? `, at ${vs.location}` : ''}`
      );
    }
    if (this.context.driverSaid) {
      parts.push(`Driver said: ${this.context.driverSaid}`);
    }
    if (this.context.driverExcuse) {
      parts.push(`Driver's excuse: ${this.context.driverExcuse}`);
    }
    if (this.context.driverCommitment) {
      parts.push(`Driver committed to: ${this.context.driverCommitment}`);
    }

    return parts.join('\n');
  }
}

// Singleton instance
export const contextStore = new ContextStore();
