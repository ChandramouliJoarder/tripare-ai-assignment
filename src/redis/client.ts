import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 500,
      retryStrategy: (times: number) => {
        if (times > 2) return null; // Stop retrying quickly if Redis is offline
        return 100;
      },
      lazyConnect: false,
    });

    redisClient.on('error', (err: Error) => logger.error({ err: err.message }, 'Redis connection error'));
    redisClient.on('connect', () => logger.info('Redis connected'));
    redisClient.on('ready', () => logger.info('Redis ready'));
  }
  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export async function checkRedisHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const client = getRedisClient();
    const pingPromise = client.ping();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Redis health check timeout')), timeoutMs)
    );
    const result = await Promise.race([pingPromise, timeoutPromise]);
    return result === 'PONG';
  } catch {
    return false;
  }
}
