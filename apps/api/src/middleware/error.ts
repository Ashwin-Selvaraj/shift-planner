import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { env } from '../lib/env.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `No route matches ${req.method} ${req.originalUrl}` });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'The request body did not pass validation',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details });
    return;
  }

  // Anything reaching here is unexpected. Log it in full but return a generic
  // message so internal details never leak to a client.
  console.error('[unhandled]', error);
  res.status(500).json({
    error: 'Something went wrong while processing the request',
    ...(env.isProduction ? {} : { detail: error instanceof Error ? error.message : String(error) }),
  });
}
