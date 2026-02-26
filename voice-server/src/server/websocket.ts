import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import { handleTwilioStream } from '../realtime/bridge';
import { findDriverByName, findDriverByPhone, Driver } from '../contacts/drivers';
import { PersonaType } from '../agent/personas';

export function setupWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/voice/stream',
  });

  wss.on('connection', (ws: WebSocket, req) => {
    // Parse query parameters from upgrade request
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const callSid = url.searchParams.get('callSid') || 'unknown';
    const from = url.searchParams.get('from') || '';
    const role = url.searchParams.get('role') as 'boss' | 'driver' | 'unknown' || 'unknown';
    const name = url.searchParams.get('name') || 'Unknown';

    console.log(`[WebSocket] Connection for call ${callSid}, role: ${role}, name: ${name}`);

    // Determine persona type
    let personaType: PersonaType;
    let driver: Driver | undefined;

    if (role === 'boss') {
      // Check if this is a callback (we're calling boss back)
      // For now, simple heuristic: if there's existing context, it's a callback
      personaType = 'boss';
    } else if (role === 'driver') {
      personaType = 'driver';
      driver = findDriverByName(name) || findDriverByPhone(from);
    } else {
      personaType = 'boss'; // Default to boss persona for unknown callers
    }

    // Set up the Twilio <-> OpenAI bridge
    handleTwilioStream(ws, callSid, from, personaType, driver);
  });

  wss.on('error', (err) => {
    console.error('[WebSocket] Server error:', err);
  });

  console.log('[WebSocket] Server ready on /voice/stream');
  return wss;
}
