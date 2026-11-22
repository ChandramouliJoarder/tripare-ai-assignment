import { Request, Response, NextFunction } from 'express';
import { logger } from '../../logger';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandlerMiddleware(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode ?? 500;
  const code = err.code ?? 'INTERNAL_ERROR';

  logger.error(
    { requestId: req.requestId, err: err.message, statusCode },
    'Request error'
  );

  res.status(statusCode).json({
    error: err.message || 'Internal server error',
    code,
  });
}
