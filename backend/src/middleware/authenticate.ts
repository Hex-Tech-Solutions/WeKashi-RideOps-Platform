import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import { UnauthorizedError } from '../types';
import type { AuthRequest } from '../types';

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    if (payload.role === 'driver') {
      req.driver = {
        id: payload.sub,
        role: 'driver',
        vendorId: payload.vendorId ?? '',
      };
    } else {
      req.user = {
        id: payload.sub,
        role: payload.role as 'admin' | 'supervisor' | 'vendor',
      };
    }
    next();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      res.status(401).json({ error: err.message, code: err.code });
    } else {
      res.status(401).json({ error: 'Invalid token', code: 'UNAUTHORIZED' });
    }
  }
}

/**
 * Authenticate but allow unauthenticated requests through (for public routes).
 */
export function optionalAuthenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    if (payload.role === 'driver') {
      req.driver = {
        id: payload.sub,
        role: 'driver',
        vendorId: payload.vendorId ?? '',
      };
    } else {
      req.user = {
        id: payload.sub,
        role: payload.role as 'admin' | 'supervisor' | 'vendor',
      };
    }
  } catch {
    // Ignore errors for optional auth
  }
  next();
}
