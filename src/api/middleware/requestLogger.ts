import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../logger';
import type pino from 'pino';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: pino.Logger;
    }
  }
}

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = uuidv4();
  req.requestId = requestId;
  req.log = logger.child({ requestId, method: req.method, path: req.path });

  const start = Date.now();
  res.on('finish', () => {
    req.log.info(
      { statusCode: res.statusCode, duration: Date.now() - start },
      'Request completed'
    );
  });

  next();
}
