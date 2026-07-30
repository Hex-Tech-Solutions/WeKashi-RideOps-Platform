import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  createIssue,
  createDriverSos,
  listIssues,
  setIssueStatus,
  assertCanAccessIssue,
  getIssueMessages,
  addIssueMessage,
  type SosIssueType,
} from '../services/issue.service';
import { sosRebook } from '../services/sosRebook.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { sanitizeDescription, sanitizeText } from '../lib/sanitize';
import type { AuthRequest } from '../types';
import type { Server as IoServer } from 'socket.io';

export function createIssuesRouter(io: IoServer): Router {
  const router = Router();
  router.use(authenticate);

  // ── GET /api/issues ──────────────────────────────────────────────────────────
  // Role-scoped: supervisor → raised by me, vendor → mine, admin → all.
  // Driver → only their own SOS issues.
  router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Driver: return only their own SOS issues
      if (req.driver) {
        const { prisma } = await import('../lib/prisma');
        const issues = await prisma.driverIssue.findMany({
          where: { driverId: req.driver.id },
          include: {
            driver:     { select: { fullName: true, phone: true } },
            supervisor: { select: { fullName: true, org: true, phone: true } },
            vendor:     { select: { name: true } },
            ride: {
              select: {
                pickupAddress: true, dropAddress: true, type: true,
                price: true, distanceKm: true, createdAt: true,
              },
            },
          },
          orderBy: [{ isSos: 'desc' }, { createdAt: 'desc' }],
        });
        res.json({ issues });
        return;
      }

      let vendorId: string | undefined;
      if (req.user?.role === 'vendor') {
        const { prisma } = await import('../lib/prisma');
        const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
        vendorId = vendor?.id;
      }
      const issues = await listIssues({
        role: req.user?.role ?? '',
        userId: req.user?.id,
        vendorId,
      });
      res.json({ issues });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/issues ─────────────────────────────────────────────────────────
  // Supervisor raises an issue about a ride's driver.
  router.post(
    '/',
    requireRole('supervisor'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { rideId, description } = z
          .object({
            rideId: z.string().uuid(),
            description: z.string().min(5).max(1000),
          })
          .parse(req.body);
        const issue = await createIssue({ supervisorId: req.user!.id, rideId, description: sanitizeDescription(description) });
        res.status(201).json(issue);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /api/issues/sos ─────────────────────────────────────────────────────
  // Driver triggers an SOS. Resolves the supervisor from the active ride.
  // Emits sos:alert to the supervisor's socket room immediately.
  router.post(
    '/sos',
    requireRole('driver'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { issueType, description, rideId } = z
          .object({
            issueType: z.enum(['vehicle_issue', 'medical_emergency', 'other']),
            description: z.string().min(3).max(500),
            rideId: z.string().uuid().optional(),
          })
          .parse(req.body);

        const { issue, supervisorId } = await createDriverSos({
          driverId: req.driver!.id,
          issueType: issueType as SosIssueType,
          description: sanitizeDescription(description),
          rideId,
        });

        // Fetch driver's current GPS location for the alert
        const { prisma } = await import('../lib/prisma');
        const driverCoords = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
          SELECT ST_Y(current_location::geometry) as lat, ST_X(current_location::geometry) as lng
          FROM drivers WHERE id = ${req.driver!.id} AND current_location IS NOT NULL
        `;
        const location = driverCoords[0] ?? null;

        // Fetch driver info for the alert payload
        const driverInfo = await prisma.driver.findUnique({
          where: { id: req.driver!.id },
          select: { fullName: true, phone: true },
        });

        // Real-time alert to the supervisor
        io.of('/supervisor')
          .to(`supervisor:${supervisorId}`)
          .emit('sos:alert', {
            issueId: issue.id,
            issueType,
            description,
            driverName: driverInfo?.fullName ?? 'Driver',
            driverPhone: driverInfo?.phone ?? null,
            rideId: issue.rideId ?? null,
            location,
          });

        // Admin activity feed
        io.of('/admin').to('admin').emit('admin:activity', {
          event: 'sos:raised',
          issueId: issue.id,
          issueType,
          driverId: req.driver!.id,
        });

        res.status(201).json(issue);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /api/issues/:id/sos-rebook ──────────────────────────────────────────
  // Supervisor cancels the original ride and creates a new one for remaining
  // passengers, starting from the driver's current GPS. Broadcasts immediately.
  router.post(
    '/:id/sos-rebook',
    requireRole('supervisor'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const result = await sosRebook(req.params.id, req.user!.id, io);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET /api/issues/:id/driver-location ──────────────────────────────────────
  // Returns the driver's current GPS coordinates for SOS issues (supervisor only).
  router.get(
    '/:id/driver-location',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const actorId   = req.user?.id ?? '';
        const actorRole = req.user?.role ?? '';
        const issue = await assertCanAccessIssue(req.params.id, { id: actorId, role: actorRole });

        if (!issue.isSos) {
          res.status(400).json({ error: 'Location only available for SOS issues', code: 'NOT_SOS' });
          return;
        }

        const { prisma } = await import('../lib/prisma');
        const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
          SELECT ST_Y(current_location::geometry) as lat, ST_X(current_location::geometry) as lng
          FROM drivers WHERE id = ${issue.driverId} AND current_location IS NOT NULL
        `;
        res.json({ location: rows[0] ?? null });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET /api/issues/:id/messages ─────────────────────────────────────────────
  // Accessible by supervisor, vendor, admin, AND the driver on their own SOS.
  router.get(
    '/:id/messages',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const actorId   = req.user?.id   ?? req.driver?.id   ?? '';
        const actorRole = req.user?.role ?? req.driver?.role ?? '';
        await assertCanAccessIssue(req.params.id, { id: actorId, role: actorRole });
        res.json({ messages: await getIssueMessages(req.params.id) });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /api/issues/:id/messages ────────────────────────────────────────────
  // Accessible by supervisor, vendor, admin, AND the driver on their own SOS.
  router.post(
    '/:id/messages',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { body } = z
          .object({ body: z.string().min(1).max(2000) })
          .parse(req.body);

        const actorId   = req.user?.id   ?? req.driver?.id   ?? '';
        const actorRole = req.user?.role ?? req.driver?.role ?? '';

        const issue = await assertCanAccessIssue(
          req.params.id,
          { id: actorId, role: actorRole },
        );

        const msg = await addIssueMessage(
          req.params.id,
          { id: actorId, role: actorRole },
          sanitizeText(body),  // sanitize before storing
        );

        // Real-time delivery: push message to the supervisor room
        io.of('/supervisor')
          .to(`supervisor:${issue.supervisorId}`)
          .emit('issue:message', { issueId: req.params.id, message: msg });

        // If the message was sent by the supervisor, push back to the driver
        if (actorRole === 'supervisor' || actorRole === 'admin') {
          io.of('/driver')
            .to(`driver:${issue.driverId}`)
            .emit('issue:message', { issueId: req.params.id, message: msg });
        }

        res.status(201).json(msg);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── PATCH /api/issues/:id ────────────────────────────────────────────────────
  // Supervisor (own issues) and admin can resolve/reopen.
  // Vendor can NOT change status — they can only chat.
  router.patch(
    '/:id',
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { status } = z
          .object({ status: z.enum(['open', 'resolved']) })
          .parse(req.body);

        // Vendor: blocked from changing status
        if (req.user?.role === 'vendor') {
          res.status(403).json({ error: 'Vendors cannot change issue status', code: 'FORBIDDEN' });
          return;
        }

        // Supervisors can only close/reopen their own issues
        if (req.user?.role === 'supervisor') {
          const issue = await assertCanAccessIssue(req.params.id, { id: req.user.id, role: 'supervisor' });
          if (issue.supervisorId !== req.user.id) {
            res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
            return;
          }
          res.json(await setIssueStatus(req.params.id, status));
          return;
        }

        // Admin only
        if (!req.user || req.user.role !== 'admin') {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
          return;
        }
        res.json(await setIssueStatus(req.params.id, status));
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

// Keep a default export for backward-compat with the old import in app.ts
// (will be replaced in app.ts to use the factory).
export default createIssuesRouter;
