import { Router, Request, Response } from 'express';
import {
  setSupplierADown,
  setSupplierBDown,
  getSupplierADown,
  getSupplierBDown,
} from './suppliers';

export const adminRouter = Router();

adminRouter.post('/admin/supplier/:name/toggle', (req: Request, res: Response) => {
  const { name } = req.params;

  if (name === 'a') {
    const newState = !getSupplierADown();
    setSupplierADown(newState);
    res.json({
      supplier: 'a',
      down: newState,
      message: `Supplier A is now ${newState ? 'DOWN' : 'UP'}`,
    });
  } else if (name === 'b') {
    const newState = !getSupplierBDown();
    setSupplierBDown(newState);
    res.json({
      supplier: 'b',
      down: newState,
      message: `Supplier B is now ${newState ? 'DOWN' : 'UP'}`,
    });
  } else {
    res.status(400).json({
      error: 'Invalid supplier name. Use "a" or "b"',
      code: 'INVALID_SUPPLIER',
    });
  }
});
