import rateLimit from 'express-rate-limit';
import { verifyAccessToken } from '../lib/jwt';

// Key by authenticated user/driver id when a valid bearer token is present,
// falling back to IP otherwise (covers login/register and any request with
// no/invalid token). This runs ahead of the `authenticate` middleware, so
// req.user/req.driver aren't populated yet — decode the token directly here.
//
// Why: a flat per-IP budget means every supervisor/vendor sitting behind the
// same office NAT (common for a B2B app like this) shares one bucket, so one
// busy office can lock out another. Keying by user id gives each logged-in
// user their own budget, while unauthenticated traffic (login attempts from
// that same office) still shares an IP-based bucket — which is fine since
// login has its own tighter authRateLimiter on top of this.
function userOrIpKey(req: import('express').Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const payload = verifyAccessToken(authHeader.slice(7));
      return `user:${payload.sub}`;
    } catch {
      // fall through to IP — expired/invalid token, let auth middleware reject it
    }
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // The app runs many background-polling queries per open dashboard
  // (dashboard/live-ops/offers/rides/wallet/driver-location etc, each on a
  // 6-30s interval). A handful of tabs/roles open concurrently adds up to
  // 60-100+ requests/min from legitimate polling alone. Keyed per-user (see
  // userOrIpKey) so this budget is per logged-in person, not shared across
  // an entire office's IP — 3000/15min comfortably covers one person running
  // several dashboards/tabs at once.
  max: 3000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  message: { error: 'Too many requests', code: 'TOO_MANY_REQUESTS' },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests', code: 'TOO_MANY_REQUESTS' },
});

export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'OTP request limit exceeded', code: 'TOO_MANY_REQUESTS' },
  keyGenerator: (req) => {
    const body = req.body as { phone?: string };
    return body.phone ?? req.ip ?? 'unknown';
  },
});

// Rate limiter for file serving — prevents enumeration and DoS via disk I/O
export const fileRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 file requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many file requests', code: 'TOO_MANY_REQUESTS' },
});

// Rate limiter for token refresh endpoint
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh requests', code: 'TOO_MANY_REQUESTS' },
});
