import { proxyActivities, log } from '@temporalio/workflow';
import type * as activities from './activities';
import type { Hotel, WorkflowResult } from '../domain/types';
import { dedupeAndSelectBest } from '../domain/dedupe';

const act = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '500ms',
    backoffCoefficient: 2,
  },
});

/**
 * Temporal workflow: fetch hotel offers from two suppliers in parallel,
 * merge/deduplicate, pick cheapest, store in Redis.
 */
export async function hotelOfferWorkflow(city: string): Promise<WorkflowResult> {
  log.info('hotelOfferWorkflow started', { city });

  // Fire both supplier fetches in parallel (allSettled so one failure doesn't kill the other)
  const [resultA, resultB] = await Promise.allSettled([
    act.fetchSupplierA(city),
    act.fetchSupplierB(city),
  ]);

  const listA = resultA.status === 'fulfilled' ? resultA.value : [];
  const listB = resultB.status === 'fulfilled' ? resultB.value : [];

  const failedSuppliers: string[] = [];
  if (resultA.status === 'rejected') {
    failedSuppliers.push('supplierA');
    log.warn('fetchSupplierA failed after retries', { city });
  }
  if (resultB.status === 'rejected') {
    failedSuppliers.push('supplierB');
    log.warn('fetchSupplierB failed after retries', { city });
  }

  // Both failed → throw so the API can return 502
  if (listA.length === 0 && listB.length === 0 && failedSuppliers.length === 2) {
    throw new Error('Both suppliers failed');
  }

  // Deduplicate: deterministic pure function (safe in workflow code)
  const hotels: Hotel[] = dedupeAndSelectBest(listA, listB);

  // Persist to Redis
  await act.saveHotelsToRedisActivity(city, hotels, failedSuppliers);

  log.info('hotelOfferWorkflow complete', { city, hotelCount: hotels.length });
  return { hotels, failedSuppliers };
}
