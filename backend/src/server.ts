import 'dotenv/config';
import http from 'http';
import { initSockets } from './sockets';
import { createApp } from './app';
import { initBroadcastSweeper, stopBroadcastSweeper } from './lib/broadcastSweeper';
import { initKycSweeper, stopKycSweeper } from './lib/kycSweeper';
import { startLocationFlusher, stopLocationFlusher, flushLocationBuffer } from './lib/locationBuffer';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { logger } from './lib/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function bootstrap(): Promise<void> {
  // Verify DB connection
  await prisma.$connect();
  logger.info('Database connected');

  // ── L2: Reset all driver isOnline flags on startup ──────────────────────────
  // Prevents drivers being permanently stuck as "online" after server crashes.
  const resetCount = await prisma.driver.updateMany({
    where: { isOnline: true },
    data: { isOnline: false },
  });
  if (resetCount.count > 0) {
    logger.info({ count: resetCount.count }, 'Reset stale driver online status on startup');
  }

  // ── M7: Purge expired/revoked refresh tokens ─────────────────────────────────
  // Runs once on startup; a scheduled job can also run this periodically.
  const purged = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revokedAt: { not: null } },
      ],
    },
  });
  if (purged.count > 0) {
    logger.info({ count: purged.count }, 'Purged expired/revoked refresh tokens');
  }

  // Create HTTP server
  const httpServer = http.createServer();

  // Initialize Socket.io (must happen before app so io is available for routes)
  const io = initSockets(httpServer);

  // Create Express app with io injected
  const app = createApp(io);
  httpServer.on('request', app);

  // Start broadcast sweeper
  initBroadcastSweeper(io);

  // Start KYC expiry sweeper
  initKycSweeper();

  // Start location buffer flusher (bulk-writes GPS positions to DB every 60s)
  startLocationFlusher();

  httpServer.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'RideOps API server started');
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');

    stopBroadcastSweeper();
    stopKycSweeper();
    stopLocationFlusher();

    httpServer.close(async () => {
      try {
        // Final flush before shutdown — don't lose buffered positions
        await flushLocationBuffer();
        await prisma.$disconnect();
        redis.disconnect();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // Force shutdown after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
