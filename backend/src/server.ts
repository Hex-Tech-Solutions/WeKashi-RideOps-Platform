import 'dotenv/config';
import http from 'http';
import { initSockets } from './sockets';
import { createApp } from './app';
import { initBroadcastSweeper, stopBroadcastSweeper } from './lib/broadcastSweeper';
import { initKycSweeper, stopKycSweeper } from './lib/kycSweeper';
import { initSignupSweeper, stopSignupSweeper } from './services/signup.service';
import { initDocExpirySweeper, stopDocExpirySweeper } from './services/docExpiry.service';
import { initPackExpirySweeper, stopPackExpirySweeper } from './services/creditNotices.service';
import { initRideReminderSweeper, stopRideReminderSweeper } from './services/rideReminders.service';
import { initFaceCheckSweeper, stopFaceCheckSweeper } from './services/faceCheck.service';
import { startLocationFlusher, stopLocationFlusher, flushLocationBuffer } from './lib/locationBuffer';
import { setDriverRidesNotifier } from './lib/activeRideCache';
import { setDriverRentalsNotifier } from './services/rental.service';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { logger } from './lib/logger';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function bootstrap(): Promise<void> {
  // Verify DB connection
  await prisma.$connect();
  logger.info('Database connected');

  // Driver online status is NOT reset on startup. Under Model 2, online is a
  // deliberate state that changes only when the driver taps Go Offline or their
  // FCM token is found dead (uninstall). The old startup reset knocked every
  // driver offline on each deploy, and apps that refreshed in that window
  // stopped receiving rides.

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
  // nginx reuses idle connections to the API (upstream keepalive, 30s). Node's
  // default keep-alive timeout is 5s: Node closed connections nginx still
  // reused, nginx saw resets, marked the API process down, and with several
  // processes returned "no live upstreams" 502s (load test, Nov 2026). Keep
  // idle connections longer than nginx does, so nginx always closes first.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000; // must exceed keepAliveTimeout

  // Initialize Socket.io (must happen before app so io is available for routes)
  const io = initSockets(httpServer);

  // Tell a driver's app the moment their rides or held rentals change, so it
  // can poll slowly the rest of the time. Goes through the Redis adapter, so
  // it reaches the driver whichever instance holds their socket.
  setDriverRidesNotifier((driverIds) => {
    for (const id of driverIds) io.of('/driver').to(`driver:${id}`).emit('driver:rides_changed', {});
  });
  setDriverRentalsNotifier((driverId) => {
    io.of('/driver').to(`driver:${driverId}`).emit('driver:rentals_changed', {});
  });

  // Create Express app with io injected
  const app = createApp(io);
  httpServer.on('request', app);

  // Background jobs (sweepers, reminders, GPS flush) must run in exactly ONE
  // API process. With several processes they would each send every reminder
  // and flush the same GPS buffer. docker-compose sets RUN_BACKGROUND_JOBS=0
  // on the extra `api-extra` processes; the main `api` keeps the default.
  const runJobs = process.env.RUN_BACKGROUND_JOBS !== '0';
  if (runJobs) {
    // Start broadcast sweeper
    initBroadcastSweeper(io);

    // Start KYC expiry sweeper
    initKycSweeper();

    // Expire sign-up requests not approved within 7 days (frees phone + vehicle)
    initSignupSweeper();

    // Document expiry reminders (30/15/7/1 days + expired) — hourly (#13)
    initDocExpirySweeper();

    // Pack-expiry reminders (30/7/1 days before unused credits expire)
    initPackExpirySweeper();

    // Pickup reminders for scheduled rides / rentals a driver holds (24h, 2h, 45min)
    initRideReminderSweeper();

    // Phase 2 face check: "face check due" pushes + 30-day selfie deletion (5 min)
    initFaceCheckSweeper();

    // Start location buffer flusher (bulk-writes GPS positions to DB every 60s)
    startLocationFlusher();
  } else {
    logger.info('Background jobs disabled in this process (RUN_BACKGROUND_JOBS=0)');
  }

  httpServer.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'RideOps API server started');
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return; // a second SIGTERM/SIGINT must not restart the sequence
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received');

    stopBroadcastSweeper();
    stopKycSweeper();
    stopSignupSweeper();
    stopDocExpirySweeper();
    stopPackExpirySweeper();
    stopRideReminderSweeper();
    stopFaceCheckSweeper();
    stopLocationFlusher();

    // Open sockets keep httpServer.close() waiting forever, which made every
    // deploy hit the 10s forced exit and skip the final location flush.
    // Disconnect this instance's sockets first (clients auto-reconnect).
    for (const ns of ['/driver', '/supervisor', '/admin']) {
      io.of(ns).local.disconnectSockets(true);
    }

    httpServer.close(async () => {
      try {
        // Final flush before shutdown — don't lose buffered positions
        if (runJobs) await flushLocationBuffer();
        await prisma.$disconnect();
        redis.disconnect();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });

    // close() waits for every open connection. nginx keeps idle keep-alive
    // connections to the API, so close idle ones now and force the rest after
    // 3s. Without this, shutdown hit the forced exit and skipped the flush.
    httpServer.closeIdleConnections();
    setTimeout(() => httpServer.closeAllConnections(), 3_000).unref();

    // Safety net. docker-compose gives the api 20s (stop_grace_period) before
    // SIGKILL, so this must stay below that.
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 15_000).unref();
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
