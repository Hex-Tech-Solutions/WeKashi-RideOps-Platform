import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import driverRouter, { createDriverRouter } from './routes/driver';
import filesRouter from './routes/files';
import { createIssuesRouter } from './routes/issues';
import supervisorRouter from './routes/supervisor';
import employeesRouter from './routes/employees';
import vendorProfileRouter from './routes/vendorProfile';
import vendorsRouter from './routes/vendors';
import vehiclesRouter from './routes/vehicles';
import payoutsRouter from './routes/payouts';
import paymentsRouter from './routes/payments';
import analyticsRouter from './routes/analytics';
import safetyRouter from './routes/safety';
import routingRouter from './routes/routing';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { globalRateLimiter, fileRateLimiter, refreshRateLimiter } from './middleware/rateLimiter';
import type { Server as IoServer } from 'socket.io';
import { createRidesRouter } from './routes/rides';
import { createDriversRouter } from './routes/drivers';

export function createApp(io: IoServer): express.Application {
  // ── Production safety checks ────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') {
      throw new Error('FATAL: CORS_ORIGIN must be set to a specific origin in production (never *)');
    }
    if (process.env.DEV_OTP_BYPASS) {
      throw new Error('FATAL: DEV_OTP_BYPASS must not be set in production');
    }
  }

  const app = express();

  // Trust proxy (for correct IP in rate-limiter when behind nginx/LB)
  app.set('trust proxy', 1);

  // ── Security headers via helmet ────────────────────────────────────────────
  app.use(helmet({
    // CSP is set loosely here — tighten per your frontend needs
    contentSecurityPolicy: false, // frontend is served by nginx/vite separately
    crossOriginEmbedderPolicy: false,
  }));
  // X-Powered-By is disabled by helmet automatically

  // Body parsing — size limits prevent DoS
  // IMPORTANT: Razorpay webhook routes need the RAW request body to verify
  // HMAC signatures — re-serializing a parsed JSON object with JSON.stringify
  // does not reliably reproduce the exact bytes Razorpay signed. These two
  // paths are excluded from the global JSON parser; the payments router
  // applies express.raw() itself for those routes only.
  const WEBHOOK_PATHS = new Set(['/api/payments/webhook', '/api/payments/payout-webhook']);
  app.use((req, res, next) => {
    if (WEBHOOK_PATHS.has(req.path)) { next(); return; }
    express.json({ limit: '1mb' })(req, res, next);
  });
  app.use((req, res, next) => {
    if (WEBHOOK_PATHS.has(req.path)) { next(); return; }
    express.urlencoded({ extended: true, limit: '1mb' })(req, res, next);
  });

  // Structured HTTP logging
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization'],
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Global rate limiter
  app.use(globalRateLimiter);

  // Health check — verifies DB and Redis connectivity
  app.get('/health', async (_req, res) => {
    try {
      const { prisma } = await import('./lib/prisma');
      const { redis } = await import('./lib/redis');
      await Promise.all([
        prisma.$queryRaw`SELECT 1`,
        redis.ping(),
      ]);
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err: any) {
      res.status(503).json({ status: 'degraded', error: err?.message ?? 'Service unavailable' });
    }
  });

  // Routes
  app.use('/api', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/files', fileRateLimiter, filesRouter);   // rate-limited file serving
  app.use('/api/issues', createIssuesRouter(io));
  app.use('/api/supervisor', supervisorRouter);
  app.use('/api/rides', createRidesRouter(io));
  app.use('/api/drivers', createDriversRouter(io));
  app.use('/api/employees', employeesRouter);
  app.use('/api/vendor', vendorProfileRouter);
  app.use('/api/driver', createDriverRouter(io));
  // Public vendor-code lookup — no auth required (driver uses this before logging in)
  app.get('/api/vendors/by-code/:code', async (req, res, next) => {
    try {
      const { prisma } = await import('./lib/prisma');
      // Validate code format before DB query — prevents NoSQL-style enumeration
      const code = (req.params.code ?? '').toUpperCase();
      if (!/^VND-[A-Z0-9]{6}$/.test(code)) {
        res.status(404).json({ error: 'Vendor code not found', code: 'NOT_FOUND' });
        return;
      }
      const vendor = await prisma.vendor.findUnique({
        where: { vendorCode: code },
        select: { id: true, name: true, vendorCode: true },
      });
      if (!vendor) { res.status(404).json({ error: 'Vendor code not found', code: 'NOT_FOUND' }); return; }
      res.json(vendor);
    } catch (err) {
      next(err);
    }
  });
  app.use('/api/vendors', vendorsRouter);
  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/payouts', payoutsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/safety', safetyRouter);
  app.use('/api/routing', routingRouter);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
