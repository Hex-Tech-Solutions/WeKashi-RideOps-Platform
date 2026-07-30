import rateLimit from 'express-rate-limit';

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', code: 'TOO_MANY_REQUESTS' },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests', code: 'TOO_MANY_REQUESTS' },
});

export const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
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
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh requests', code: 'TOO_MANY_REQUESTS' },
});
