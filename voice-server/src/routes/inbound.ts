import { Router, Request, Response } from 'express';
import { config } from '../config';
import { orchestrator } from '../agent/orchestrator';
import { findDriverByPhone, bossPhone } from '../contacts/drivers';

export const inboundRouter = Router();

/**
 * POST /voice/inbound
 * Twilio webhook for incoming calls
 * Returns TwiML to connect to Media Streams
 */
inboundRouter.post('/inbound', (req: Request, res: Response) => {
  const callSid = req.body.CallSid || 'unknown';
  const from = req.body.From || '';
  const to = req.body.To || '';

  console.log(`[Inbound] Call from ${from} to ${to}, CallSid: ${callSid}`);

  // Identify caller
  let callerRole: 'boss' | 'driver' | 'unknown' = 'unknown';
  let callerName = 'Unknown';

  const normalizedFrom = from.replace(/\D/g, '');
  const normalizedBoss = bossPhone.replace(/\D/g, '');

  if (normalizedFrom.endsWith(normalizedBoss.slice(-10))) {
    callerRole = 'boss';
    callerName = 'Boss';
  } else {
    const driver = findDriverByPhone(from);
    if (driver) {
      callerRole = 'driver';
      callerName = driver.name;
    }
  }

  console.log(`[Inbound] Caller identified as: ${callerRole} (${callerName})`);

  // Register the call with orchestrator
  orchestrator.startCall({
    callSid,
    direction: 'inbound',
    callerPhone: from,
    callerRole,
    callerName,
    personaType: callerRole === 'boss' ? 'boss' : 'driver',
    startTime: new Date(),
  });

  // Build WebSocket URL for Media Streams
  const wsUrl = config.publicUrl.replace(/^http/, 'ws');
  const streamUrl = `${wsUrl}/voice/stream?callSid=${callSid}&from=${encodeURIComponent(from)}&role=${callerRole}&name=${encodeURIComponent(callerName)}`;

  // Return TwiML
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callSid" value="${callSid}" />
      <Parameter name="callerPhone" value="${from}" />
      <Parameter name="callerRole" value="${callerRole}" />
      <Parameter name="callerName" value="${callerName}" />
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});
