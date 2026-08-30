import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An error carrying the HTTP status the API should respond with. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, message);
export const forbidden = (message = 'You do not have access to this action') =>
  new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) =>
  new HttpError(409, message, details);

/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware instead of becoming an unhandled rejection and hanging the request.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Reads a required path parameter. Express types `req.params` as an index
 * signature, so under `noUncheckedIndexedAccess` every lookup is possibly
 * undefined; this narrows it once, loudly, instead of casting at each use.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value) throw badRequest(`Missing "${name}" in the request path`);
  return value;
}
