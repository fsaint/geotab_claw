import { Router, Request, Response } from 'express';
import { orchestrator } from '../agent/orchestrator';
import { config } from '../config';
import { demoState, setMikeMoving, setMikeStoppedMinutes } from '../fleet/mock-data';

export const statusRouter = Router();

/**
 * POST /voice/status
 * Twilio call status webhook
 */
statusRouter.post('/status', (req: Request, res: Response) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;
  const from = req.body.From;
  const to = req.body.To;

  console.log(`[Status] Call ${callSid}: ${callStatus} (${from} -> ${to})`);

  // Handle call completion
  if (callStatus === 'completed' || callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed') {
    const call = orchestrator.getActiveCall(callSid);
    if (call) {
      orchestrator.endCall(callSid, `Call ${callStatus}`);

      // If there's a pending outbound call, it will be triggered by the bridge when the WebSocket closes
    }
  }

  res.sendStatus(200);
});

/**
 * GET /voice/status
 * Health check and current state
 */
statusRouter.get('/status', (_req: Request, res: Response) => {
  const activeCalls = orchestrator.getActiveCalls();

  res.json({
    status: 'ok',
    state: orchestrator.getState(),
    activeCalls: activeCalls.map((c) => ({
      callSid: c.callSid,
      direction: c.direction,
      callerRole: c.callerRole,
      callerName: c.callerName,
      personaType: c.personaType,
      duration: Math.round((Date.now() - c.startTime.getTime()) / 1000),
    })),
    hasPendingOutbound: orchestrator.hasPendingOutbound(),
  });
});

/**
 * POST /voice/reset
 * Reset orchestrator state (for demo)
 */
statusRouter.post('/reset', (_req: Request, res: Response) => {
  orchestrator.reset();
  // Also reset demo state
  setMikeMoving(false);
  setMikeStoppedMinutes(40);
  res.json({ status: 'reset', state: orchestrator.getState(), demoState });
});

/**
 * GET /voice/demo
 * Get current demo state
 */
statusRouter.get('/demo', (_req: Request, res: Response) => {
  res.json({
    demoMode: config.demoMode,
    state: demoState,
  });
});

/**
 * POST /voice/demo
 * Update demo state (for controlling the scenario)
 *
 * Body options:
 * - mikeMoving: boolean - set Mike to driving/stopped
 * - mikeStoppedMinutes: number - how long Mike has been stopped
 */
statusRouter.post('/demo', (req: Request, res: Response) => {
  if (!config.demoMode) {
    return res.status(400).json({ error: 'Not in demo mode' });
  }

  const { mikeMoving, mikeStoppedMinutes } = req.body;

  if (typeof mikeMoving === 'boolean') {
    setMikeMoving(mikeMoving);
  }
  if (typeof mikeStoppedMinutes === 'number') {
    setMikeStoppedMinutes(mikeStoppedMinutes);
  }

  res.json({
    status: 'updated',
    demoState,
  });
});
