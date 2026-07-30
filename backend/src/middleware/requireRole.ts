import { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types';

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const role = req.user?.role ?? req.driver?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

export function requireUser(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  next();
}

export function requireDriver(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.driver) {
    res.status(401).json({ error: 'Driver authentication required', code: 'UNAUTHORIZED' });
    return;
  }
  next();
}
