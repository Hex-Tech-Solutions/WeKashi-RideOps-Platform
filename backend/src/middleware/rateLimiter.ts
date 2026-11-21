import rateLimit from 'express-rate-limit';
import { verifyAccessToken } from '../lib/jwt';
import { RedisRateLimitStore } from '../lib/redisRateLimitStore';

// Counts live in Redis so all API processes share them. If Redis is down,
// requests pass rather than fail (passOnStoreError); the app needs Redis anyway.
const shared = (name: string) => ({ store: new RedisRateLimitStore(`rl:${name}:`), passOnStoreError: true });

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
  ...shared('global'),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Per IP. Many phones share one IP on Indian mobile networks (carrier NAT).
  // OTPs are also limited per phone number: 5 requests / 10 min, 5 tries per code.
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests', code: 'TOO_MANY_REQUESTS' },
  ...shared('auth'),
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
  ...shared('otp'),
});

// Rate limiter for file serving — prevents enumeration and DoS via disk I/O
export const fileRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,            // per IP; vendors reviewing documents open many files
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many file requests', code: 'TOO_MANY_REQUESTS' },
  ...shared('file'),
});

// Rate limiter for token refresh endpoint
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Every signed-in user refreshes once per access-token lifetime, and a refused
  // refresh logs them out. Generous per IP (carrier NAT); needs a valid token.
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh requests', code: 'TOO_MANY_REQUESTS' },
  ...shared('refresh'),
});
