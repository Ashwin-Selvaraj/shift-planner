import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@shift-planner/core';
import { env } from '../lib/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { can, permissionsFor, type Permission } from '../lib/permissions.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Set when the signed-in user is also in the employee master. */
  employeeId?: string | null;
  teamId?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: Role;
  employeeId?: string | null;
  teamId?: string | null;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as jwt.SignOptions);
}

/** Populates `req.user` from the bearer token, or rejects with 401. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Provide a bearer token in the Authorization header'));
    return;
  }
  try {
    const decoded = jwt.verify(header.slice(7), env.jwtSecret) as TokenPayload;
    req.user = {
      id: decoded.sub,
      email: decoded.email,
      name: decoded.name,
      role: decoded.role,
      employeeId: decoded.employeeId ?? null,
      teamId: decoded.teamId ?? null,
    };
    next();
  } catch {
    next(unauthorized('Your session has expired. Please sign in again.'));
  }
}

/** Guards a route behind one of the permissions in BRD section 6. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      next(unauthorized());
      return;
    }
    const granted = permissions.some((permission) => can(user.role, permission));
    if (!granted) {
      next(
        forbidden(
          `Your role (${user.role.replace(/_/g, ' ').toLowerCase()}) cannot perform this action.`,
        ),
      );
      return;
    }
    next();
  };
}

export { permissionsFor };
