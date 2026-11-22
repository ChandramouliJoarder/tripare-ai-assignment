export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue: process.env.TASK_QUEUE ?? 'hotel-offers',
  supplierBaseUrl: process.env.SUPPLIER_BASE_URL ?? 'http://localhost:3000',
  supplierADown: process.env.SUPPLIER_A_DOWN === 'true',
  supplierBDown: process.env.SUPPLIER_B_DOWN === 'true',
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS ?? '300', 10),
  logLevel: (process.env.LOG_LEVEL ?? 'info') as string,
};
