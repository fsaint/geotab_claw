import express, { Express } from 'express';
import { inboundRouter } from '../routes/inbound';
import { outboundRouter } from '../routes/outbound';
import { statusRouter } from '../routes/status';

export function createExpressApp(): Express {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req, _res, next) => {
    console.log(`[HTTP] ${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get('/', (_req, res) => {
    res.json({
      name: 'Claw Voice Server',
      version: '1.0.0',
      status: 'running',
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Routes
  app.use('/voice', inboundRouter);
  app.use('/voice', outboundRouter);
  app.use('/voice', statusRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[HTTP] Error:', err);
    res.status(500).json({ error: err.message });
  });

  return app;
}
