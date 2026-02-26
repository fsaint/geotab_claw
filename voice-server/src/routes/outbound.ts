import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config';
import { orchestrator } from '../agent/orchestrator';
import { findDriverByName, bossPhone } from '../contacts/drivers';

export const outboundRouter = Router();

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

/**
 * POST /voice/outbound
 * Trigger an outbound call
 */
outboundRouter.post('/outbound', async (req: Request, res: Response) => {
  try {
    const { target, reason } = req.body;

    if (!target) {
      return res.status(400).json({ error: 'target is required' });
    }

    let phone: string;
    let callerRole: 'boss' | 'driver' = 'driver';
    let callerName = target;

    if (target.toLowerCase() === 'boss') {
      phone = bossPhone;
      callerRole = 'boss';
      callerName = 'Boss';
    } else {
      const driver = findDriverByName(target);
      if (!driver) {
        return res.status(404).json({ error: `Driver "${target}" not found` });
      }
      phone = driver.phone;
      callerName = driver.name;
    }

    console.log(`[Outbound] Initiating call to ${callerName} (${phone})`);

    const call = await initiateOutboundCall(phone, callerName, reason || 'check in');

    res.json({
      success: true,
      callSid: call.sid,
      to: phone,
      target: callerName,
    });
  } catch (err) {
    console.error('[Outbound] Error:', err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /voice/outbound/twiml
 * TwiML for outbound calls - connects to Media Streams
 */
outboundRouter.post('/outbound/twiml', (req: Request, res: Response) => {
  const callSid = req.body.CallSid || req.query.callSid || 'unknown';
  const to = req.body.To || req.query.to || '';
  const role = req.query.role || 'driver';
  const name = req.query.name || 'Unknown';

  console.log(`[Outbound TwiML] Call ${callSid} answered by ${name}`);

  // Build WebSocket URL
  const wsUrl = config.publicUrl.replace(/^http/, 'ws');
  const streamUrl = `${wsUrl}/voice/stream?callSid=${callSid}&from=${encodeURIComponent(to)}&role=${role}&name=${encodeURIComponent(name as string)}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callSid" value="${callSid}" />
      <Parameter name="callerPhone" value="${to}" />
      <Parameter name="callerRole" value="${role}" />
      <Parameter name="callerName" value="${name}" />
    </Stream>
  </Connect>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

/**
 * Initiate an outbound call
 */
export async function initiateOutboundCall(
  phone: string,
  name: string,
  reason: string
): Promise<{ sid: string }> {
  // Determine persona based on who we're calling
  const isCallingBoss = phone.replace(/\D/g, '').endsWith(bossPhone.replace(/\D/g, '').slice(-10));
  const role = isCallingBoss ? 'boss' : 'driver';
  const personaType = isCallingBoss ? 'callback' : 'driver';

  // Register with orchestrator
  const driver = !isCallingBoss ? findDriverByName(name) : undefined;

  // Build TwiML URL with query params
  const twimlUrl = `${config.publicUrl}/voice/outbound/twiml?role=${role}&name=${encodeURIComponent(name)}`;

  // Make the call
  const call = await twilioClient.calls.create({
    to: phone,
    from: config.twilio.phoneNumber,
    url: twimlUrl,
    statusCallback: `${config.publicUrl}/voice/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    statusCallbackMethod: 'POST',
  });

  console.log(`[Outbound] Call initiated: ${call.sid}`);

  // Register with orchestrator
  orchestrator.startCall({
    callSid: call.sid,
    direction: 'outbound',
    callerPhone: phone,
    callerRole: role as 'boss' | 'driver',
    callerName: name,
    personaType,
    startTime: new Date(),
  });

  return { sid: call.sid };
}
