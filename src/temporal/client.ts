import { Connection, Client } from '@temporalio/client';
import { config } from '../config';
import { logger } from '../logger';

let temporalClient: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (temporalClient) return temporalClient;

  const connection = await Connection.connect({
    address: config.temporalAddress,
  });

  temporalClient = new Client({
    connection,
    namespace: config.temporalNamespace,
  });

  logger.info('Temporal client connected');
  return temporalClient;
}

export async function checkTemporalHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const connectPromise = Connection.connect({
      address: config.temporalAddress,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Temporal health check timeout')), timeoutMs)
    );
    const connection = await Promise.race([connectPromise, timeoutPromise]);
    await connection.close();
    return true;
  } catch {
    return false;
  }
}
