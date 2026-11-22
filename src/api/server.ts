import express from 'express';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { errorHandlerMiddleware } from './middleware/errorHandler';
import { hotelsRouter } from './routes/hotels';
import { suppliersRouter } from './routes/suppliers';
import { adminRouter } from './routes/admin';
import { healthRouter } from './routes/health';

const app = express();

app.use(express.json());
app.use(requestLoggerMiddleware);

// API routes
app.use(healthRouter);
app.use(hotelsRouter);
app.use(suppliersRouter);
app.use(adminRouter);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../../public')));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../public', 'index.html'));
});

// Error handler (must be last)
app.use(errorHandlerMiddleware);

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Hotel Offer Orchestrator API listening');
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal');
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      const { closeRedisClient } = await import('../redis/client');
      await closeRedisClient();
      logger.info('Redis connection closed');
    } catch {
      // ignore
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

export { app };
