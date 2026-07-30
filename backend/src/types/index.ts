import { Request } from 'express';

export interface AuthUser {
  id: string;
  role: 'admin' | 'supervisor' | 'vendor';
}

export interface AuthDriver {
  id: string;
  role: 'driver';
  vendorId: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  driver?: AuthDriver;
}

export interface JwtAccessPayload {
  sub: string;
  role: 'admin' | 'supervisor' | 'vendor' | 'driver';
  vendorId?: string;
}

export interface JwtRefreshPayload {
  sub: string;
  role: 'admin' | 'supervisor' | 'vendor' | 'driver';
  jti: string;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface NearbyDriver {
  id: string;
  full_name: string;
  rating: number;
  vehicle_id: string | null;
  distance_m: number;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(409, message, 'CONFLICT');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, message, 'TOO_MANY_REQUESTS');
  }
}
