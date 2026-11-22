import { Router, Request, Response } from 'express';
import axios from 'axios';
import { checkRedisHealth } from '../../redis/client';
import { checkTemporalHealth } from '../../temporal/client';
import { config } from '../../config';
import { HealthStatus } from '../../domain/types';

export const healthRouter = Router();

healthRouter.get('/health', async (_req: Request, res: Response) => {
  const timeout = 2000;

  const [supplierAResult, supplierBResult, redisResult, temporalResult] =
    await Promise.allSettled([
      axios
        .get(`${config.supplierBaseUrl}/supplierA/hotels?city=delhi`, { timeout })
        .then(() => true)
        .catch(() => false),
      axios
        .get(`${config.supplierBaseUrl}/supplierB/hotels?city=delhi`, { timeout })
        .then(() => true)
        .catch(() => false),
      checkRedisHealth(),
      checkTemporalHealth(),
    ]);

  const sA: 'up' | 'down' =
    supplierAResult.status === 'fulfilled' && supplierAResult.value ? 'up' : 'down';
  const sB: 'up' | 'down' =
    supplierBResult.status === 'fulfilled' && supplierBResult.value ? 'up' : 'down';
  const redis: 'up' | 'down' =
    redisResult.status === 'fulfilled' && redisResult.value ? 'up' : 'down';
  const temporal: 'up' | 'down' =
    temporalResult.status === 'fulfilled' && temporalResult.value ? 'up' : 'down';

  let overallStatus: 'ok' | 'degraded' | 'down';
  if (sA === 'down' && sB === 'down') {
    // Only truly "down" when both data suppliers are unreachable
    overallStatus = 'down';
  } else if (sA === 'down' || sB === 'down' || redis === 'down' || temporal === 'down') {
    // Redis/Temporal are optional infrastructure — their absence is degraded, not fatal
    overallStatus = 'degraded';
  } else {
    overallStatus = 'ok';
  }

  const health: HealthStatus = {
    status: overallStatus,
    suppliers: { supplierA: sA, supplierB: sB },
    redis,
    temporal,
    checkedAt: new Date().toISOString(),
  };

  res.status(overallStatus === 'down' ? 503 : 200).json(health);
});
