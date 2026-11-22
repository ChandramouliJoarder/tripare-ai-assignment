import { getRedisClient } from './client';
import { Hotel } from '../domain/types';
import { config } from '../config';
import { logger } from '../logger';
import { normalizeHotelName } from '../domain/dedupe';

function hotelHashKey(city: string, normalizedName: string): string {
  return `hotel:${city}:${normalizedName}`;
}

function priceIndexKey(city: string): string {
  return `hotels:${city}:by_price`;
}

function metaKey(city: string): string {
  return `hotels:${city}:meta`;
}

/**
 * Save deduplicated hotels to Redis using MULTI/pipeline:
 *  - hotel:{city}:{normalizedName} hashes
 *  - hotels:{city}:by_price sorted set (score = price)
 *  - hotels:{city}:meta hash (updatedAt, failedSuppliers)
 *  All keys get a TTL of CACHE_TTL_SECONDS.
 */
export async function saveHotelsToRedis(
  city: string,
  hotels: Hotel[],
  failedSuppliers: string[] = []
): Promise<void> {
  const redis = getRedisClient();
  const ttl = config.cacheTtlSeconds;
  const normalizedCity = city.toLowerCase().trim();

  const priceKey = priceIndexKey(normalizedCity);
  const meta = metaKey(normalizedCity);

  // Delete old keys for this city first
  const oldMembers = await redis.zrange(priceKey, 0, -1);

  const pipeline = redis.multi();

  for (const member of oldMembers) {
    pipeline.del(member);
  }
  pipeline.del(priceKey);
  pipeline.del(meta);

  // Write new data
  for (const hotel of hotels) {
    const normalized = normalizeHotelName(hotel.name);
    const hashKey = hotelHashKey(normalizedCity, normalized);

    pipeline.hset(hashKey, {
      name: hotel.name,
      price: hotel.price.toString(),
      supplier: hotel.supplier,
      commissionPct: hotel.commissionPct.toString(),
    });
    pipeline.expire(hashKey, ttl);
    pipeline.zadd(priceKey, hotel.price, hashKey);
  }

  pipeline.hset(meta, {
    updatedAt: new Date().toISOString(),
    failedSuppliers: failedSuppliers.join(','),
    hotelCount: hotels.length.toString(),
  });
  pipeline.expire(meta, ttl);
  pipeline.expire(priceKey, ttl);

  await pipeline.exec();

  logger.info({ city: normalizedCity, count: hotels.length }, 'Hotels saved to Redis');
}

/**
 * Fetch hotels from Redis, using ZRANGEBYSCORE for in-Redis price filtering.
 * Returns null if the cache is empty / expired for this city.
 */
export async function getHotelsFromRedis(
  city: string,
  minPrice?: number,
  maxPrice?: number
): Promise<Hotel[] | null> {
  try {
    const redis = getRedisClient();
    const normalizedCity = city.toLowerCase().trim();
    const priceKey = priceIndexKey(normalizedCity);
    const meta = metaKey(normalizedCity);

    // Check if cache exists
    const metaData = await redis.hgetall(meta);
    if (!metaData || !metaData['updatedAt']) {
      return null; // cache miss
    }

    // --- PRICE FILTERING INSIDE REDIS via ZRANGEBYSCORE ---
    const min: string | number = minPrice !== undefined ? minPrice : '-inf';
    const max: string | number = maxPrice !== undefined ? maxPrice : '+inf';

    const hashKeys = await redis.zrangebyscore(priceKey, min, max);

    if (hashKeys.length === 0) {
      return [];
    }

    // Pipeline HGETALL for each matching hotel hash
    const pipeline = redis.pipeline();
    for (const key of hashKeys) {
      pipeline.hgetall(key);
    }

    const results = await pipeline.exec();
    if (!results) return [];

    const hotels: Hotel[] = [];
    for (const [err, data] of results) {
      if (err || !data) continue;
      const record = data as Record<string, string>;
      if (record['name']) {
        hotels.push({
          name: record['name'],
          price: parseFloat(record['price'] ?? '0'),
          supplier: record['supplier'] ?? '',
          commissionPct: parseFloat(record['commissionPct'] ?? '0'),
        });
      }
    }

    return hotels.sort((a, b) => a.price - b.price);
  } catch (err) {
    logger.warn({ err: String(err) }, 'Redis read failed or Redis not available');
    return null;
  }
}

/**
 * Get the meta information for a city's cache.
 */
export async function getCityCacheMeta(
  city: string
): Promise<{ updatedAt: string; failedSuppliers: string[] } | null> {
  try {
    const redis = getRedisClient();
    const normalizedCity = city.toLowerCase().trim();
    const meta = await redis.hgetall(metaKey(normalizedCity));
    if (!meta || !meta['updatedAt']) return null;
    return {
      updatedAt: meta['updatedAt'],
      failedSuppliers: meta['failedSuppliers']
        ? meta['failedSuppliers'].split(',').filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * Delete all cached data for a city.
 */
export async function deleteCityCache(city: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const normalizedCity = city.toLowerCase().trim();
    const priceKey = priceIndexKey(normalizedCity);
    const meta = metaKey(normalizedCity);

    const oldMembers = await redis.zrange(priceKey, 0, -1);
    const pipeline = redis.pipeline();
    for (const member of oldMembers) {
      pipeline.del(member);
    }
    pipeline.del(priceKey);
    pipeline.del(meta);
    await pipeline.exec();
  } catch {
    // Ignore cache clear error if Redis is offline
  }
}
