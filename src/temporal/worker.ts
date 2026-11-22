import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { config } from '../config';
import { logger } from '../logger';

async function runWorker(): Promise<void> {
  let retries = 0;
  const maxRetries = 30;

  while (retries < maxRetries) {
    try {
      logger.info(
        { address: config.temporalAddress, taskQueue: config.taskQueue },
        'Connecting Temporal worker...'
      );

      const connection = await NativeConnection.connect({
        address: config.temporalAddress,
      });

      const worker = await Worker.create({
        connection,
        workflowsPath: require.resolve('./workflows'),
        activities,
        taskQueue: config.taskQueue,
        namespace: config.temporalNamespace,
      });

      // Graceful shutdown
      const shutdown = (): void => {
        logger.info('Received shutdown signal, stopping worker...');
        worker.shutdown();
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      logger.info({ taskQueue: config.taskQueue }, 'Temporal worker started successfully');
      await worker.run();
      return;
    } catch (err) {
      retries++;
      const delay = Math.min(retries * 2000, 15000);
      logger.warn(
        { err: String(err), retries, maxRetries, delayMs: delay },
        `Worker startup failed, retrying in ${delay}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error('Worker failed to start after maximum retries');
  process.exit(1);
}

runWorker().catch((err) => {
  logger.error({ err: String(err) }, 'Fatal worker error');
  process.exit(1);
});
