import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { getTemporalClient } from '../../temporal/client';
import { config } from '../../config';
import {
  getHotelsFromRedis,
  getCityCacheMeta,
  deleteCityCache,
  saveHotelsToRedis,
} from '../../redis/hotelStore';
import { WorkflowResult } from '../../domain/types';
import { logger } from '../../logger';
import { supplierAData, supplierBData } from '../../domain/mockData';
import { normalizeHotelName, dedupeAndSelectBest } from '../../domain/dedupe';

export const hotelsRouter = Router();

hotelsRouter.get(
  '/api/hotels',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const city = (req.query['city'] as string | undefined)?.toLowerCase().trim();
      const refresh = req.query['refresh'] === 'true';
      const minPriceRaw = req.query['minPrice'] as string | undefined;
      const maxPriceRaw = req.query['maxPrice'] as string | undefined;

      // --- Validation ---
      if (!city) {
        res
          .status(400)
          .json({ error: 'city query parameter is required', code: 'MISSING_CITY' });
        return;
      }

      let minPrice: number | undefined;
      let maxPrice: number | undefined;

      if (minPriceRaw !== undefined) {
        minPrice = parseFloat(minPriceRaw);
        if (isNaN(minPrice) || minPrice < 0) {
          res.status(400).json({
            error: 'minPrice must be a non-negative number',
            code: 'INVALID_PRICE',
          });
          return;
        }
      }

      if (maxPriceRaw !== undefined) {
        maxPrice = parseFloat(maxPriceRaw);
        if (isNaN(maxPrice) || maxPrice < 0) {
          res.status(400).json({
            error: 'maxPrice must be a non-negative number',
            code: 'INVALID_PRICE',
          });
          return;
        }
      }

      if (
        minPrice !== undefined &&
        maxPrice !== undefined &&
        minPrice > maxPrice
      ) {
        res.status(400).json({
          error: 'minPrice must be <= maxPrice',
          code: 'INVALID_PRICE_RANGE',
        });
        return;
      }

      // --- Check Redis cache (unless refresh=true) ---
      if (!refresh) {
        const cached = await getHotelsFromRedis(city, minPrice, maxPrice);
        if (cached !== null) {
          const meta = await getCityCacheMeta(city);
          logger.info(
            { city, count: cached.length, cached: true },
            'Returning cached hotel data'
          );

          const failedSuppliers = meta?.failedSuppliers ?? [];
          if (failedSuppliers.length > 0) {
            res.setHeader('X-Partial-Result', 'true');
            res.setHeader('X-Failed-Suppliers', failedSuppliers.join(','));
          }
          if (meta?.updatedAt) {
            res.setHeader('X-Cached-At', meta.updatedAt);
          }

          res.json(cached);
          return;
        }
      } else {
        await deleteCityCache(city);
      }

      // --- Run Temporal workflow (or fallback if Temporal server is offline) ---
      let workflowResult: WorkflowResult;
      try {
        const client = await getTemporalClient();
        const workflowId = `hotels-${city}-${Date.now()}`;

        logger.info({ city, workflowId }, 'Starting Temporal workflow');

        workflowResult = await client.workflow.execute('hotelOfferWorkflow', {
          taskQueue: config.taskQueue,
          workflowId,
          args: [city],
        });
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (errorMsg.includes('Both suppliers failed')) {
          res.status(502).json({
            error: 'Both suppliers are unavailable',
            code: 'SUPPLIERS_DOWN',
          });
          return;
        }

        // If Temporal server is unreachable (e.g. running in local standalone dev mode without Temporal container)
        logger.warn({ err: errorMsg }, 'Temporal cluster unreachable, falling back to direct parallel fetch');
        const [resA, resB] = await Promise.allSettled([
          axios.get(`${config.supplierBaseUrl}/supplierA/hotels`, { params: { city }, timeout: 4500 }).then(r => r.data),
          axios.get(`${config.supplierBaseUrl}/supplierB/hotels`, { params: { city }, timeout: 4500 }).then(r => r.data),
        ]);

        const listA = resA.status === 'fulfilled' ? resA.value : [];
        const listB = resB.status === 'fulfilled' ? resB.value : [];
        const failedSuppliers: string[] = [];
        if (resA.status === 'rejected') failedSuppliers.push('supplierA');
        if (resB.status === 'rejected') failedSuppliers.push('supplierB');

        if (listA.length === 0 && listB.length === 0 && failedSuppliers.length === 2) {
          res.status(502).json({
            error: 'Both suppliers are unavailable',
            code: 'SUPPLIERS_DOWN',
          });
          return;
        }

        const hotels = dedupeAndSelectBest(listA, listB);
        // Best effort async save to Redis if available
        saveHotelsToRedis(city, hotels, failedSuppliers).catch(() => {});
        workflowResult = { hotels, failedSuppliers };
      }

      const { hotels, failedSuppliers } = workflowResult;

      if (hotels.length === 0 && failedSuppliers.length === 2) {
        res.status(502).json({
          error: 'Both suppliers are unavailable',
          code: 'SUPPLIERS_DOWN',
        });
        return;
      }

      // Price filter via Redis (ZRANGEBYSCORE happens inside Redis, not in JS)
      let filtered = await getHotelsFromRedis(city, minPrice, maxPrice);
      if (filtered === null) {
        // Fallback filter in memory only if Redis is not running
        filtered = hotels.filter((h) => {
          if (minPrice !== undefined && h.price < minPrice) return false;
          if (maxPrice !== undefined && h.price > maxPrice) return false;
          return true;
        });
      }

      const meta = await getCityCacheMeta(city);

      if (failedSuppliers.length > 0) {
        res.setHeader('X-Partial-Result', 'true');
        res.setHeader('X-Failed-Suppliers', failedSuppliers.join(','));
      }
      if (meta?.updatedAt) {
        res.setHeader('X-Cached-At', meta.updatedAt);
      }

      logger.info(
        { city, count: filtered.length, failedSuppliers },
        'Returning hotel data'
      );
      res.json(filtered);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Compare endpoint: returns both supplier offers per hotel for a city
 * (used by the frontend for "beat Supplier X by ₹Y" annotations).
 */
hotelsRouter.get(
  '/api/hotels/compare',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const city = (req.query['city'] as string | undefined)?.toLowerCase().trim();
      if (!city) {
        res
          .status(400)
          .json({ error: 'city query parameter is required', code: 'MISSING_CITY' });
        return;
      }

      const aHotels = supplierAData.filter(
        (h) => h.city.toLowerCase() === city
      );
      const bHotels = supplierBData.filter(
        (h) => h.city.toLowerCase() === city
      );

      const allNames = new Set([
        ...aHotels.map((h) => normalizeHotelName(h.name)),
        ...bHotels.map((h) => normalizeHotelName(h.name)),
      ]);

      const comparison = Array.from(allNames).map((normalizedName) => {
        const aOffer = aHotels.find(
          (h) => normalizeHotelName(h.name) === normalizedName
        );
        const bOffer = bHotels.find(
          (h) => normalizeHotelName(h.name) === normalizedName
        );
        return {
          normalizedName,
          displayName: (aOffer ?? bOffer)?.name ?? normalizedName,
          supplierA: aOffer
            ? { price: aOffer.price, commissionPct: aOffer.commissionPct }
            : null,
          supplierB: bOffer
            ? { price: bOffer.price, commissionPct: bOffer.commissionPct }
            : null,
        };
      });

      res.json(comparison);
    } catch (err) {
      next(err);
    }
  }
);
