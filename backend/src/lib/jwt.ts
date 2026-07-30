import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { JwtAccessPayload, JwtRefreshPayload, UnauthorizedError } from '../types';

// ── Fail hard on missing or default secrets in production ─────────────────────
const KNOWN_DEFAULTS = new Set(['dev-access-secret', 'dev-refresh-secret']);

function requireSecret(envVar: string, fallback: string): string {
  const value = process.env[envVar] ?? fallback;
  if (process.env.NODE_ENV === 'production' && KNOWN_DEFAULTS.has(value)) {
    throw new Error(
      `FATAL: ${envVar} is not set or is using an insecure default. ` +
      `Set a strong secret in your production environment.`,
    );
  }
  return value;
}

const ACCESS_SECRET  = requireSecret('JWT_ACCESS_SECRET',  'dev-access-secret');
const REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret');
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRY  ?? '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY ?? '7d';

export function signAccessToken(payload: Omit<JwtAccessPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRY as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(
  sub: string,
  role: JwtRefreshPayload['role'],
): { token: string; jti: string; expiresAt: Date } {
  const jti = uuidv4();
  const token = jwt.sign({ sub, role, jti }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRY as jwt.SignOptions['expiresIn'],
  });

  // Calculate expiry date
  const decoded = jwt.decode(token) as { exp: number };
  const expiresAt = new Date(decoded.exp * 1000);

  return { token, jti, expiresAt };
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  try {
    return jwt.verify(token, ACCESS_SECRET) as JwtAccessPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Access token expired');
    }
    throw new UnauthorizedError('Invalid access token');
  }
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  try {
    return jwt.verify(token, REFRESH_SECRET) as JwtRefreshPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Refresh token expired');
    }
    throw new UnauthorizedError('Invalid refresh token');
  }
}

export function getRefreshTokenExpiry(): Date {
  const decoded = jwt.decode(
    jwt.sign({}, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRY as jwt.SignOptions['expiresIn'] }),
  ) as { exp: number };
  return new Date(decoded.exp * 1000);
}
