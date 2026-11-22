import { Router, Request, Response } from 'express';
import { supplierAData, supplierBData } from '../../domain/mockData';
import { logger } from '../../logger';

export const suppliersRouter = Router();

// In-memory override state for supplier down simulation
let supplierADownOverride: boolean | null = null;
let supplierBDownOverride: boolean | null = null;

export function getSupplierADown(): boolean {
  if (supplierADownOverride !== null) return supplierADownOverride;
  return process.env.SUPPLIER_A_DOWN === 'true';
}

export function getSupplierBDown(): boolean {
  if (supplierBDownOverride !== null) return supplierBDownOverride;
  return process.env.SUPPLIER_B_DOWN === 'true';
}

export function setSupplierADown(val: boolean): void {
  supplierADownOverride = val;
}

export function setSupplierBDown(val: boolean): void {
  supplierBDownOverride = val;
}

suppliersRouter.get('/supplierA/hotels', (req: Request, res: Response) => {
  if (getSupplierADown()) {
    logger.warn('Supplier A is down (simulated)');
    res.status(503).json({ error: 'Supplier A is currently unavailable', code: 'SUPPLIER_DOWN' });
    return;
  }

  const city = (req.query['city'] as string | undefined)?.toLowerCase().trim();
  const results = city
    ? supplierAData.filter((h) => h.city.toLowerCase() === city)
    : supplierAData;

  logger.info({ supplier: 'A', city, count: results.length }, 'Supplier A responded');
  res.json(results);
});

suppliersRouter.get('/supplierB/hotels', (req: Request, res: Response) => {
  if (getSupplierBDown()) {
    logger.warn('Supplier B is down (simulated)');
    res.status(503).json({ error: 'Supplier B is currently unavailable', code: 'SUPPLIER_DOWN' });
    return;
  }

  const city = (req.query['city'] as string | undefined)?.toLowerCase().trim();
  const results = city
    ? supplierBData.filter((h) => h.city.toLowerCase() === city)
    : supplierBData;

  logger.info({ supplier: 'B', city, count: results.length }, 'Supplier B responded');
  res.json(results);
});
