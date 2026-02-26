import http from 'http';
import { config, validateConfig } from './config';
import { createExpressApp } from './server/express';
import { setupWebSocketServer } from './server/websocket';

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('  Claw Voice Server');
  console.log('  Fleet Dispatch AI with Voice');
  console.log('='.repeat(50));

  // Validate configuration
  validateConfig();

  // Create Express app
  const app = createExpressApp();

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket server
  setupWebSocketServer(server);

  // Start listening
  server.listen(config.port, () => {
    console.log('');
    console.log(`[Server] HTTP server listening on port ${config.port}`);
    console.log(`[Server] Public URL: ${config.publicUrl}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET  /              - Health check`);
    console.log(`  POST /voice/inbound - Twilio inbound webhook`);
    console.log(`  POST /voice/outbound - Trigger outbound call`);
    console.log(`  GET  /voice/status  - Current state`);
    console.log(`  POST /voice/reset   - Reset state`);
    console.log(`  WSS  /voice/stream  - Twilio Media Streams`);
    console.log('');
    console.log('[Server] Ready for calls!');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Server] Shutting down...');
    server.close(() => {
      console.log('[Server] Goodbye!');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
