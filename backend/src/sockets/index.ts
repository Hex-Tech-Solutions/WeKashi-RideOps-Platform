import { Server as HttpServer } from 'http';
import { Server as IoServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedisClient } from '../lib/redis';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { JwtAccessPayload } from '../types';

interface AuthSocket extends Socket {
  data: {
    userId?: string;
    driverId?: string;
    role: string;
    vendorId?: string;
  };
}

function extractToken(socket: Socket): string | null {
  const token =
    (socket.handshake.auth as Record<string, string>).token ??
    (socket.handshake.headers.authorization ?? '').replace('Bearer ', '');
  return token || null;
}

function verifySocketToken(token: string): JwtAccessPayload | null {
  try {
    return verifyAccessToken(token);
  } catch {
    return null;
  }
}

export function initSockets(httpServer: HttpServer): IoServer {
  const io = new IoServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN ?? '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Redis adapter for multi-instance support
  const pubClient = createRedisClient();
  const subClient = createRedisClient();
  io.adapter(createAdapter(pubClient, subClient));

  // ─── /supervisor namespace ─────────────────────────────────────────────────
  const supervisorNs = io.of('/supervisor');

  supervisorNs.use((socket: Socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = verifySocketToken(token);
    if (!payload || payload.role !== 'supervisor') {
      return next(new Error('Forbidden: supervisor role required'));
    }

    (socket as AuthSocket).data = {
      userId: payload.sub,
      role: payload.role,
    };
    next();
  });

  supervisorNs.on('connection', (socket: Socket) => {
    const s = socket as AuthSocket;
    const supervisorId = s.data.userId!;

    s.join(`supervisor:${supervisorId}`);
    logger.info({ supervisorId, socketId: s.id }, 'Supervisor connected');

    s.on('disconnect', () => {
      logger.info({ supervisorId, socketId: s.id }, 'Supervisor disconnected');
    });

    s.on('ping', () => {
      s.emit('pong', { timestamp: Date.now() });
    });
  });

  // ─── /driver namespace ─────────────────────────────────────────────────────
  const driverNs = io.of('/driver');

  driverNs.use(async (socket: Socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = verifySocketToken(token);
    if (!payload || payload.role !== 'driver') {
      return next(new Error('Forbidden: driver role required'));
    }

    // Fetch driver to get vendorId
    const driver = await prisma.driver.findUnique({
      where: { id: payload.sub },
      select: { id: true, vendorId: true, status: true },
    });

    if (!driver || driver.status !== 'active') {
      return next(new Error('Driver account not active'));
    }

    (socket as AuthSocket).data = {
      driverId: payload.sub,
      role: 'driver',
      vendorId: driver.vendorId,
    };
    next();
  });

  driverNs.on('connection', async (socket: Socket) => {
    const s = socket as AuthSocket;
    const driverId = s.data.driverId!;
    const vendorId = s.data.vendorId!;

    s.join(`vendor:${vendorId}`);
    s.join(`driver:${driverId}`);

    // Mark driver online
    await prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: true },
    });

    logger.info({ driverId, vendorId, socketId: s.id }, 'Driver connected');

    s.on('disconnect', async () => {
      await prisma.driver.update({
        where: { id: driverId },
        data: { isOnline: false },
      });
      logger.info({ driverId, socketId: s.id }, 'Driver disconnected');
    });

    s.on('ping', () => {
      s.emit('pong', { timestamp: Date.now() });
    });
  });

  // ─── /admin namespace ──────────────────────────────────────────────────────
  const adminNs = io.of('/admin');

  adminNs.use((socket: Socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      return next(new Error('Authentication required'));
    }

    const payload = verifySocketToken(token);
    if (!payload || payload.role !== 'admin') {
      return next(new Error('Forbidden: admin role required'));
    }

    (socket as AuthSocket).data = {
      userId: payload.sub,
      role: payload.role,
    };
    next();
  });

  adminNs.on('connection', (socket: Socket) => {
    const s = socket as AuthSocket;
    const adminId = s.data.userId!;

    s.join('admin');
    logger.info({ adminId, socketId: s.id }, 'Admin connected');

    s.on('disconnect', () => {
      logger.info({ adminId, socketId: s.id }, 'Admin disconnected');
    });

    s.on('ping', () => {
      s.emit('pong', { timestamp: Date.now() });
    });
  });

  logger.info('Socket.io initialized with /supervisor, /driver, /admin namespaces');
  return io;
}
