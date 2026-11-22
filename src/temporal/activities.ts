import { Context } from '@temporalio/activity';
import axios from 'axios';
import { SupplierHotel, Hotel } from '../domain/types';
import { config } from '../config';
import { logger } from '../logger';
import { saveHotelsToRedis as saveToRedis } from '../redis/hotelStore';

/**
 * Activity: fetch hotels from Supplier A's mock endpoint.
 */
export async function fetchSupplierA(city: string): Promise<SupplierHotel[]> {
  const start = Date.now();
  const info = Context.current().info;
  logger.info({ supplier: 'A', city, attempt: info.attempt }, 'fetchSupplierA started');

  try {
    const response = await axios.get<SupplierHotel[]>(
      `${config.supplierBaseUrl}/supplierA/hotels`,
      { params: { city }, timeout: 4500 }
    );
    const duration = Date.now() - start;
    logger.info({ supplier: 'A', city, count: response.data.length, duration }, 'fetchSupplierA success');
    return response.data;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error({ supplier: 'A', city, duration, err: String(err) }, 'fetchSupplierA failed');
    throw err;
  }
}

/**
 * Activity: fetch hotels from Supplier B's mock endpoint.
 */
export async function fetchSupplierB(city: string): Promise<SupplierHotel[]> {
  const start = Date.now();
  const info = Context.current().info;
  logger.info({ supplier: 'B', city, attempt: info.attempt }, 'fetchSupplierB started');

  try {
    const response = await axios.get<SupplierHotel[]>(
      `${config.supplierBaseUrl}/supplierB/hotels`,
      { params: { city }, timeout: 4500 }
    );
    const duration = Date.now() - start;
    logger.info({ supplier: 'B', city, count: response.data.length, duration }, 'fetchSupplierB success');
    return response.data;
  } catch (err) {
    const duration = Date.now() - start;
    logger.error({ supplier: 'B', city, duration, err: String(err) }, 'fetchSupplierB failed');
    throw err;
  }
}

/**
 * Activity: persist the final hotel list to Redis.
 */
export async function saveHotelsToRedisActivity(
  city: string,
  hotels: Hotel[],
  failedSuppliers: string[]
): Promise<void> {
  const start = Date.now();
  logger.info({ city, hotelCount: hotels.length }, 'saveHotelsToRedis activity started');
  try {
    await saveToRedis(city, hotels, failedSuppliers);
    const duration = Date.now() - start;
    logger.info({ city, duration }, 'saveHotelsToRedis activity success');
  } catch (err) {
    logger.error({ city, err: String(err) }, 'saveHotelsToRedis activity failed');
    throw err;
  }
}
