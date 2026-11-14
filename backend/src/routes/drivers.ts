import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import {
  createDriver,
  listDrivers,
  getDriver,
  updateDriverStatus,
  updateDriverLocation,
  listLiveDriverLocations,
  removeDriver,
} from '../services/driver.service';
import { listDocumentsForVendor, setDocumentStatus, countPendingDocsForVendor } from '../services/document.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { ForbiddenError, ConflictError } from '../types';
import type { AuthRequest } from '../types';
import { requireIndianMobile, assertNoIdentityConflict, IDENTITY_CONFLICT_MESSAGE } from '../lib/identity';
import { rejectSignup } from '../services/signup.service';
import type { Server as IoServer } from 'socket.io';

// Resolve the caller's vendor id for ownership scoping.
//   - admin  → undefined (intentionally unscoped: admin sees all)
//   - vendor → their vendor id, or THROW if it can't be resolved.
// Fail-closed: previously this returned undefined on a failed lookup, which
// silently DISABLED the ownership check in the document/status services and
// let a mis-provisioned vendor act on any tenant's drivers.
async function vendorIdFor(req: AuthRequest): Promise<string | undefined> {
  if (req.user?.role !== 'vendor') return undefined;
  const { prisma } = await import('../lib/prisma');
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } });
  if (!vendor) throw new ForbiddenError('No vendor account is associated with this user');
  return vendor.id;
}

const CreateDriverSchema = z.object({
  phone: z.string().min(10).max(15),
  fullName: z.string().min(2).max(100),
  vehicleId: z.string().uuid().optional(),
});

const UpdateStatusSchema = z.object({
  status: z.enum(['pending', 'active', 'blacklisted', 'expired']),
});

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export function createDriversRouter(io: IoServer): Router {
  const router = Router();

  router.use(authenticate);

  // GET /drivers
  router.get(
    '/',
    requireRole('vendor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { page, limit } = parsePagination(req.query.page, req.query.limit);
        const status = req.query.status as string | undefined;

        let vendorId: string | undefined;
        if (req.user?.role === 'vendor') {
          // Fail-closed: throws if the vendor record can't be resolved, so a
          // broken vendor can't fall through to an unscoped (all-tenants) list.
          vendorId = await vendorIdFor(req);
        } else {
          // Admin can filter by vendorId
          vendorId = req.query.vendorId as string | undefined;
        }

        const result = await listDrivers({ vendorId, status, page, limit });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /drivers/pending-docs-count — vendor only: number of docs awaiting approval
  // NOTE: must be declared BEFORE /:id so Express doesn't treat "pending-docs-count" as an id
  router.get(
    '/pending-docs-count',
    requireRole('vendor'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const vendorId = await vendorIdFor(req);
        if (!vendorId) { res.json({ count: 0 }); return; }
        const count = await countPendingDocsForVendor(vendorId);
        res.json({ count });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /drivers/live-locations — admin live cab map (declared before /:id)
  router.get(
    '/live-locations',
    requireRole('admin'),
    async (_req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        res.json({ drivers: await listLiveDriverLocations() });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /drivers — vendor creates driver
  router.post(
    '/',
    requireRole('vendor'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { prisma } = await import('../lib/prisma');
        const vendor = await prisma.vendor.findUnique({ where: { userId: req.user!.id } });
        if (!vendor) {
          res.status(400).json({ error: 'Vendor account not found', code: 'NOT_FOUND' });
          return;
        }

        const body = CreateDriverSchema.parse(req.body);
        const phone = requireIndianMobile(body.phone);
        await assertNoIdentityConflict({ phone }, undefined, 'vendor-add-driver');
        let driver;
        try {
          driver = await createDriver({ ...body, phone, vendorId: vendor.id });
        } catch (e: any) {
          if (e?.code === 'P2002') throw new ConflictError(IDENTITY_CONFLICT_MESSAGE);
          throw e;
        }
        res.status(201).json(driver);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /drivers/:id — vendor (own drivers only), admin, or the driver themselves.
  // Supervisors are NOT allowed: the full driver record carries govId, licence,
  // UPI VPA and alt-phone, which a supervisor has no need for (they see the
  // limited driver summary embedded in their own rides). Previously a supervisor
  // fell through to the full payload — full cross-vendor PII harvesting.
  router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user?.role === 'supervisor') {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
      }
      const driver = await getDriver(req.params.id);
      // Ownership check: vendor can only see their own drivers, drivers only themselves.
      if (req.user?.role === 'vendor') {
        const { prisma } = await import('../lib/prisma');
        const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } });
        if (driver.vendorId !== vendor?.id) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
        }
      } else if (req.driver) {
        if (driver.id !== req.driver.id) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
        }
      }
      // admin sees all
      res.json(driver);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /drivers/:id/status — vendor or admin
  router.patch(
    '/:id/status',
    requireRole('vendor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { status } = UpdateStatusSchema.parse(req.body);

        // Fail-closed vendor scoping (admin → undefined, sees all).
        const vendorId = await vendorIdFor(req);

        const driver = await updateDriverStatus(req.params.id, status, vendorId);
        res.json(driver);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /drivers/:id/reject-signup — vendor (own) or admin rejects a pending
  // sign-up request. NOT a blacklist: the phone and vehicle number are freed so
  // the person can apply again.
  router.post(
    '/:id/reject-signup',
    requireRole('vendor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const role = req.user!.role === 'admin' ? 'admin' : 'vendor';
        const vendorId = await vendorIdFor(req);
        await rejectSignup(req.params.id, { role, vendorId });
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  // DELETE /drivers/:id — vendor (own driver) or admin. Soft delete that keeps
  // history and frees the driver's details for a fresh sign-up elsewhere.
  router.delete(
    '/:id',
    requireRole('vendor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const role = req.user!.role === 'admin' ? 'admin' : 'vendor';
        const vendorId = await vendorIdFor(req);
        await removeDriver(req.params.id, { role, vendorId });
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /drivers/:id/documents — vendor (own driver) or admin
  router.get(
    '/:id/documents',
    requireRole('vendor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const vendorId = await vendorIdFor(req);
        res.json({ documents: await listDocumentsForVendor(req.params.id, vendorId) });
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /drivers/:id/documents/:docId — verify/reject a document
  router.patch(
    '/:id/documents/:docId',
    requireRole('vendor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { status, rejectionNote } = z.object({
          status: z.enum(['pending', 'verified', 'rejected']),
          rejectionNote: z.string().max(500).optional(),
        }).parse(req.body);
        const vendorId = await vendorIdFor(req);
        // reviewedBy: use the logged-in user's full name / email
        const { prisma } = await import('../lib/prisma');
        const reviewer = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true } });
        const reviewedBy = reviewer?.fullName ?? 'Unknown';
        res.json(await setDocumentStatus(req.params.docId, status, reviewedBy, rejectionNote, vendorId));
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /drivers/:id/location — driver only
  router.post(
    '/:id/location',
    requireRole('driver'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { lat, lng } = LocationSchema.parse(req.body);

        // Driver can only update their own location
        if (req.driver!.id !== req.params.id) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
          return;
        }

        await updateDriverLocation(req.driver!.id, lat, lng);

        // Emit location to supervisor (throttled via Redis)
        const { redis } = await import('../lib/redis');
        const { prisma } = await import('../lib/prisma');

        // Find active ride for this driver
        const activeRide = await prisma.ride.findFirst({
          where: {
            driverId: req.driver!.id,
            status: 'in_progress',
          },
          select: { id: true, supervisorId: true },
        });

        if (activeRide) {
          const throttleKey = `loc:throttle:${activeRide.id}:${req.driver!.id}`;
          const shouldSend = await redis.set(throttleKey, '1', 'EX', 3, 'NX');

          if (shouldSend === 'OK') {
            io.of('/supervisor')
              .to(`supervisor:${activeRide.supervisorId}`)
              .emit('driver:location', {
                driverId: req.driver!.id,
                rideId: activeRide.id,
                lat,
                lng,
                timestamp: new Date().toISOString(),
              });
          }
        }

        res.json({ message: 'Location updated' });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
