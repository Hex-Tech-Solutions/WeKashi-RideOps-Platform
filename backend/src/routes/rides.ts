import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import {
  createRide,
  listRides,
  getRide,
  getRideDetail,
  acceptRide,
  rejectRide,
  cancelRide,
  advanceRideStatus,
  rebroadcastRide,
  claimScheduledRide,
  driverReleaseScheduledRide,
  nearbyDriversForRide,
  manualAssignRide,
} from '../services/ride.service';
import { getRidePax, verifyPickup, verifyDrop, markNoShow, verifyEscortDrop } from '../services/ridePax.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import type { AuthRequest } from '../types';
import type { Server as IoServer } from 'socket.io';

const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const CreateRideSchema = z.object({
  type: z.enum(['login', 'logout', 'scheduled']),
  pickupPoint: GeoPointSchema,
  dropPoint: GeoPointSchema,
  pickupAddress: z.string().min(1),
  dropAddress: z.string().min(1),
  employeeIds: z.array(z.string().uuid()).min(1),
  scheduledFor: z.string().datetime().optional(),
  capacity: z.number().int().positive().optional(),
  vendorId: z.string().uuid().optional(),
  distanceKm: z.number().positive().optional(),
  vehicleType: z.enum(['hatchback', 'sedan', 'suv']).optional(),
  /** AC flat surcharge option (₹100). */
  isAc: z.boolean().optional(),
  /** Manual fare top-up the supervisor picks at booking time (must be one of the allowed options). */
  fareAdjustment: z.number().min(0).max(1000).optional(),
  scheduled: z.boolean().optional(),
  /** Per-employee expected pickup times — empId → HH:MM */
  scheduledPickupTimes: z.record(z.string().regex(/^\d{2}:\d{2}$/)).optional(),
  /** Planned departure time set by supervisor (ISO string) */
  plannedStartTime: z.string().datetime().optional(),
  /** Women's safety escort */
  escortRequired: z.boolean().optional(),
  escortName: z.string().max(100).optional().nullable(),
});

const AdvanceStatusSchema = z.object({
  status: z.enum(['pending', 'broadcasting', 'assigned', 'in_progress', 'completed', 'cancelled', 'expired']),
});

export function createRidesRouter(io: IoServer): Router {
  const router = Router();

  // All ride routes require authentication
  router.use(authenticate);

  // GET /rides
  router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = parsePagination(req.query.page, req.query.limit);
      const status = req.query.status as string | undefined;

      let filters: Parameters<typeof listRides>[0];

      if (req.driver) {
        filters = {
          role: 'driver',
          driverId: req.driver.id,
          vendorId: req.driver.vendorId,
          page,
          limit,
          status,
        };
      } else if (req.user?.role === 'supervisor') {
        filters = { role: 'supervisor', userId: req.user.id, page, limit, status };
      } else if (req.user?.role === 'vendor') {
        // Get vendor for this user
        const { prisma } = await import('../lib/prisma');
        const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
        filters = {
          role: 'vendor',
          vendorId: vendor?.id,
          page,
          limit,
          status,
        };
      } else {
        filters = { role: 'admin', page, limit, status };
      }

      const result = await listRides(filters);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rides/vehicle-options?lat=&lng=&pax= — which vehicle types are
  // allowed (by group size) and how many are online nearby.
  router.get('/vehicle-options', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const pax = Number(req.query.pax) || 1;
      const { allowedVehicleTypes } = await import('../lib/pricing');
      const { vehicleAvailability } = await import('../services/driver.service');
      const allowed = allowedVehicleTypes(pax);
      const availability = Number.isFinite(lat) && Number.isFinite(lng)
        ? await vehicleAvailability(lat, lng, 10)
        : {};
      const options = (['hatchback', 'sedan', 'suv'] as const).map((type) => ({
        type,
        allowed: allowed.includes(type),
        availableCount: availability[type] ?? 0,
      }));
      res.json({ options });
    } catch (err) {
      next(err);
    }
  });

  // POST /rides — supervisor only
  router.post(
    '/',
    requireRole('supervisor'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const body = CreateRideSchema.parse(req.body);

        // ── Server-side escort policy re-validation ───────────────────────────
        // Fetch employee genders from DB in the EXACT order the supervisor submitted
        // (employeeIds is already the final route order after any manual reorder).
        const { prisma } = await import('../lib/prisma');
        const employeeMap = await prisma.employee.findMany({
          where: { id: { in: body.employeeIds } },
          select: { id: true, gender: true },
        });
        // Preserve submitted order (not DB fetch order)
        const genderById = Object.fromEntries(employeeMap.map((e) => [e.id, e.gender]));
        const orderedGenders = body.employeeIds.map((id) => genderById[id] ?? 'M');
        // Per-stop times in route order (from scheduledPickupTimes map)
        const orderedTimes = body.employeeIds.map((id) => body.scheduledPickupTimes?.[id] ?? null);

        const { evaluateEscortPolicy } = await import('../lib/escortPolicy');
        const rideTime = body.plannedStartTime
          ? new Date(body.plannedStartTime)
          : body.scheduledFor
          ? new Date(body.scheduledFor)
          : null;
        const policy = evaluateEscortPolicy({
          passengers: orderedGenders.map((g) => ({ gender: g })),
          rideTime,
          rideType: body.type,
          orderedGenders,
          orderedTimes,
        });

        // Hard block: if escort is required but no name was provided
        if (policy.required && !body.escortName?.trim()) {
          res.status(422).json({
            error: 'Escort is mandatory for this ride but no escort name was provided',
            code: 'ESCORT_REQUIRED',
            reason: policy.reason,
          });
          return;
        }

        const result = await createRide(
          {
            ...body,
            supervisorId: req.user!.id,
            scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
            plannedStartTime: body.plannedStartTime ? new Date(body.plannedStartTime) : undefined,
            escortRequired: policy.required,
            escortName: policy.required ? (body.escortName?.trim() ?? null) : null,
          },
          io,
        );
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /rides/:id/arrived — driver marks they've arrived at first pickup
  router.post('/:id/arrived', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { prisma } = await import('../lib/prisma');
      const ride = await getRide(req.params.id);
      if (ride.driverId !== req.driver!.id) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }
      if (!['assigned', 'in_progress'].includes(ride.status)) {
        res.status(400).json({ error: 'Ride is not active', code: 'VALIDATION_ERROR' });
        return;
      }
      await prisma.$executeRaw`
        UPDATE rides
        SET driver_reporting_time = NOW()
        WHERE id = ${req.params.id} AND driver_reporting_time IS NULL
      `;
      res.json({ ok: true, driverReportingTime: new Date() });
    } catch (err) {
      next(err);
    }
  });

  // GET /rides/:id/driver-location — current driver position for live tracking
  router.get('/:id/driver-location', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { prisma } = await import('../lib/prisma');
      const ride = await getRide(req.params.id);
      if (req.user?.role === 'supervisor' && ride.supervisorId !== req.user.id) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
      }
      if (!ride.driverId) { res.json({ lat: null, lng: null }); return; }
      const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
        SELECT ST_Y(current_location::geometry) as lat,
               ST_X(current_location::geometry) as lng
        FROM drivers WHERE id = ${ride.driverId} AND current_location IS NOT NULL
      `;
      res.json(rows[0] ?? { lat: null, lng: null });
    } catch (err) { next(err); }
  });

  // GET /rides/:id/detail — full detail for completed-ride sheet
  router.get('/:id/detail', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const detail = await getRideDetail(req.params.id);
      // Drivers can only see their own rides
      if (req.driver && detail.driver?.id !== req.driver.id) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
        return;
      }
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  // GET /rides/:id — ownership scoped
  router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ride = await getRide(req.params.id);
      // Ownership check
      if (req.driver && ride.driverId !== req.driver.id) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
      }
      if (req.user?.role === 'supervisor' && ride.supervisorId !== req.user.id) {
        res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
      }
      if (req.user?.role === 'vendor') {
        const { prisma } = await import('../lib/prisma');
        const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } });
        if (ride.vendorId !== vendor?.id) {
          res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return;
        }
      }
      res.json(ride);
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/accept — driver only
  router.post(
    '/:id/accept',
    requireRole('driver'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        await acceptRide(req.params.id, req.driver!.id);

        // Notify supervisor
        const ride = await getRide(req.params.id);
        io.of('/supervisor')
          .to(`supervisor:${ride.supervisorId}`)
          .emit('driver:accepted', {
            rideId: req.params.id,
            driverId: req.driver!.id,
          });

        io.of('/admin').to('admin').emit('admin:activity', {
          event: 'ride:accepted',
          rideId: req.params.id,
          driverId: req.driver!.id,
        });

        res.json({ message: 'Ride accepted successfully' });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /rides/:id/reject — driver only
  router.post(
    '/:id/reject',
    requireRole('driver'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        await rejectRide(req.params.id, req.driver!.id);
        res.json({ message: 'Ride rejected' });
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /rides/:id/pax — ordered passengers + per-leg status (OTPs for supervisor/admin)
  router.get('/:id/pax', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ride = await getRide(req.params.id);
      let includeOtp = false;
      if (req.driver) {
        if (ride.driverId !== req.driver.id) { res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return; }
      } else if (req.user?.role === 'supervisor') {
        if (ride.supervisorId !== req.user.id) { res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' }); return; }
        includeOtp = true;
      } else if (req.user?.role === 'admin') {
        includeOtp = true;
      }
      res.json(await getRidePax(req.params.id, { includeOtp }));
    } catch (err) {
      next(err);
    }
  });

  const notifyPax = async (rideId: string, event: string) => {
    const ride = await getRide(rideId);
    io.of('/supervisor').to(`supervisor:${ride.supervisorId}`).emit('ride:status_changed', { rideId, status: ride.status });
    io.of('/admin').to('admin').emit('admin:activity', { event, rideId });
  };

  // POST /rides/:id/pax/:paxId/pickup — verify pickup OTP
  router.post('/:id/pax/:paxId/pickup', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { otp } = z.object({ otp: z.string().min(4).max(6) }).parse(req.body);
      const result = await verifyPickup(req.params.id, req.params.paxId, otp, req.driver!.id);
      await notifyPax(req.params.id, 'pax:picked');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/pax/:paxId/drop — verify drop OTP
  router.post('/:id/pax/:paxId/drop', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { otp } = z.object({ otp: z.string().min(4).max(6) }).parse(req.body);
      const result = await verifyDrop(req.params.id, req.params.paxId, otp, req.driver!.id);
      await notifyPax(req.params.id, 'pax:dropped');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/pax/:paxId/no-show — mark passenger no-show
  router.post('/:id/pax/:paxId/no-show', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await markNoShow(req.params.id, req.params.paxId, req.driver!.id);
      await notifyPax(req.params.id, 'pax:no_show');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/escort-drop — verify escort return-drop OTP (logout escort
  // rides only). The supervisor relays this OTP to the driver directly after
  // confirming with the escort in person — it's never SMS'd automatically.
  router.post('/:id/escort-drop', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { otp } = z.object({ otp: z.string().min(4).max(6) }).parse(req.body);
      const result = await verifyEscortDrop(req.params.id, otp, req.driver!.id);
      await notifyPax(req.params.id, 'escort:dropped');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /rides/:id/nearby-drivers?radius= — drivers near pickup (manual assign)
  router.get('/:id/nearby-drivers', requireRole('supervisor', 'admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const radius = Math.min(Math.max(Number(req.query.radius) || 5, 1), 20);
      res.json({ drivers: await nearbyDriversForRide(req.params.id, radius) });
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/assign — supervisor/admin manually assigns a driver (+ optional price)
  router.post('/:id/assign', requireRole('supervisor', 'admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { driverId, price } = z.object({ driverId: z.string().uuid(), price: z.number().positive().optional() }).parse(req.body);
      await manualAssignRide(req.params.id, driverId, price, req.user!.id, req.user!.role);
      io.of('/admin').to('admin').emit('admin:activity', { event: 'ride:assigned', rideId: req.params.id });
      res.json({ message: 'Ride assigned' });
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/claim — driver claims a scheduled ride
  router.post('/:id/claim', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await claimScheduledRide(req.params.id, req.driver!.id);
      const ride = await getRide(req.params.id);
      io.of('/supervisor').to(`supervisor:${ride.supervisorId}`).emit('ride:status_changed', { rideId: req.params.id, status: 'assigned' });
      res.json({ message: 'Scheduled ride claimed' });
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/release — driver hands a claimed scheduled ride back to the
  // marketplace. Allowed any time before the trip starts; the fine depends on
  // how much notice is given (free at 24h+, see releaseFine in lib/pricing.ts).
  router.post('/:id/release', requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await driverReleaseScheduledRide(req.params.id, req.driver!.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /rides/:id/cancel — supervisor or admin
  router.post(
    '/:id/cancel',
    requireRole('supervisor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const requestorId   = req.user!.id;
        const requestorRole = req.user!.role;
        const { cancellationFee } = await cancelRide(req.params.id, requestorId, requestorRole);

        io.of('/admin').to('admin').emit('admin:activity', {
          event: 'ride:cancelled',
          rideId: req.params.id,
        });

        res.json({ message: 'Ride cancelled', cancellationFee });
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /rides/:id/force-cancel — supervisor or admin, SOS context.
  router.post(
    '/:id/force-cancel',
    requireRole('supervisor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const requestorId   = req.user!.id;
        const requestorRole = req.user!.role;
        await cancelRide(req.params.id, requestorId, requestorRole, true);

        io.of('/admin').to('admin').emit('admin:activity', {
          event: 'ride:force_cancelled',
          rideId: req.params.id,
        });

        res.json({ message: 'Ride force-cancelled (SOS)' });
      } catch (err) {
        next(err);
      }
    },
  );

  // PATCH /rides/:id/status — advance state machine (driver, supervisor, or admin only)
  router.patch(
    '/:id/status',
    requireRole('driver', 'supervisor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        const { status } = AdvanceStatusSchema.parse(req.body);
        const requestorId = req.user?.id ?? req.driver?.id ?? '';
        const requestorRole = req.user?.role ?? req.driver?.role ?? '';

        const updated = await advanceRideStatus(
          req.params.id,
          status,
          requestorId,
          requestorRole,
        );

        // Emit status change to supervisor
        const ride = await getRide(req.params.id);
        io.of('/supervisor')
          .to(`supervisor:${ride.supervisorId}`)
          .emit('ride:status_changed', { rideId: req.params.id, status });

        io.of('/admin').to('admin').emit('admin:activity', {
          event: 'ride:status_changed',
          rideId: req.params.id,
          status,
        });

        res.json(updated);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /rides/:id/rebroadcast — supervisor or admin
  router.post(
    '/:id/rebroadcast',
    requireRole('supervisor', 'admin'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
      try {
        await rebroadcastRide(
          req.params.id,
          req.user!.id,
          req.user!.role,
          io,
        );
        res.json({ message: 'Ride rebroadcast initiated' });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
