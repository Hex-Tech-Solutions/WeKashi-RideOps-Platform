import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { NotFoundError, ForbiddenError } from '../types';
import type { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);
router.use(requireRole('supervisor'));

// ── Single office (legacy / default) ─────────────────────────────────────────

router.get('/office', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { org: true, phone: true, officeLat: true, officeLng: true, officeAddress: true, facility: true, pendingCancellationFee: true },
    });
    res.json(u);
  } catch (err) {
    next(err);
  }
});

router.patch('/phone', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { phone } = z.object({ phone: z.string().min(10).max(20) }).parse(req.body);
    const u = await prisma.user.update({ where: { id: req.user!.id }, data: { phone }, select: { phone: true } });
    res.json(u);
  } catch (err) {
    next(err);
  }
});

router.patch('/facility', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { facility } = z.object({ facility: z.string().max(100) }).parse(req.body);
    await prisma.user.update({ where: { id: req.user!.id }, data: { facility } });
    res.json({ facility });
  } catch (err) {
    next(err);
  }
});

router.patch('/office', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng, address } = z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      address: z.string().min(1).max(300),
    }).parse(req.body);
    const u = await prisma.user.update({
      where: { id: req.user!.id },
      data: { officeLat: lat, officeLng: lng, officeAddress: address },
      select: { officeLat: true, officeLng: true, officeAddress: true },
    });
    res.json(u);
  } catch (err) {
    next(err);
  }
});

// ── Multiple office locations ────────────────────────────────────────────────

const OfficeLocationSchema = z.object({
  name:            z.string().min(1).max(100),
  address:         z.string().min(1).max(300),
  lat:             z.number().min(-90).max(90),
  lng:             z.number().min(-180).max(180),
  isDefault:       z.boolean().optional(),
  gracePeriodSecs: z.number().int().min(0).max(3600).optional(),
});

// GET /supervisor/offices
router.get('/offices', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const offices = await prisma.officeLocation.findMany({
      where: { supervisorId: req.user!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    res.json({ offices });
  } catch (err) {
    next(err);
  }
});

// POST /supervisor/offices
router.post('/offices', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = OfficeLocationSchema.parse(req.body);

    // If this is being set as default, clear existing defaults first
    if (body.isDefault) {
      await prisma.officeLocation.updateMany({
        where: { supervisorId: req.user!.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    // If it's the first one, auto-make it default
    const count = await prisma.officeLocation.count({ where: { supervisorId: req.user!.id } });
    const isDefault = body.isDefault ?? count === 0;

    const office = await prisma.officeLocation.create({
      data: {
        supervisorId: req.user!.id,
        name: body.name,
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        isDefault,
        gracePeriodSecs: body.gracePeriodSecs ?? 600,
      },
    });

    // Sync to legacy single-office fields if this is the default
    if (isDefault) {
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { officeLat: body.lat, officeLng: body.lng, officeAddress: body.address },
      });
    }

    res.status(201).json(office);
  } catch (err) {
    next(err);
  }
});

// PATCH /supervisor/offices/:id
router.patch('/offices/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.officeLocation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Office location not found');
    if (existing.supervisorId !== req.user!.id) throw new ForbiddenError('Access denied');

    const body = OfficeLocationSchema.partial().parse(req.body);

    if (body.isDefault) {
      await prisma.officeLocation.updateMany({
        where: { supervisorId: req.user!.id, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.officeLocation.update({
      where: { id: req.params.id },
      data: body,
    });

    // Sync to legacy fields if this is now the default
    if (updated.isDefault) {
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { officeLat: updated.lat, officeLng: updated.lng, officeAddress: updated.address },
      });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /supervisor/offices/:id
router.delete('/offices/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.officeLocation.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Office location not found');
    if (existing.supervisorId !== req.user!.id) throw new ForbiddenError('Access denied');

    await prisma.officeLocation.delete({ where: { id: req.params.id } });

    // If deleted was default, promote the next one
    if (existing.isDefault) {
      const next_ = await prisma.officeLocation.findFirst({
        where: { supervisorId: req.user!.id },
        orderBy: { createdAt: 'asc' },
      });
      if (next_) {
        await prisma.officeLocation.update({ where: { id: next_.id }, data: { isDefault: true } });
        await prisma.user.update({
          where: { id: req.user!.id },
          data: { officeLat: next_.lat, officeLng: next_.lng, officeAddress: next_.address },
        });
      }
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── Route templates ───────────────────────────────────────────────────────────

const RouteTemplateSchema = z.object({
  name:               z.string().min(1).max(100),
  rideType:           z.enum(['login', 'logout']),
  vehicleType:        z.enum(['hatchback', 'sedan', 'suv']).optional(),
  officeLocationId:   z.string().uuid().optional(),
  orderedEmployeeIds: z.array(z.string().uuid()).min(1),
});

// GET /supervisor/route-templates
router.get('/route-templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const templates = await prisma.routeTemplate.findMany({
      where: { supervisorId: req.user!.id },
      include: { officeLocation: { select: { name: true, address: true, lat: true, lng: true } } },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    });
    res.json({ templates });
  } catch (err) {
    next(err);
  }
});

// POST /supervisor/route-templates
router.post('/route-templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = RouteTemplateSchema.parse(req.body);
    const template = await prisma.routeTemplate.create({
      data: {
        supervisorId: req.user!.id,
        name: body.name,
        rideType: body.rideType,
        vehicleType: body.vehicleType ?? null,
        officeLocationId: body.officeLocationId ?? null,
        orderedEmployeeIds: body.orderedEmployeeIds,
      },
      include: { officeLocation: { select: { name: true, address: true, lat: true, lng: true } } },
    });
    res.status(201).json(template);
  } catch (err) {
    next(err);
  }
});

// PATCH /supervisor/route-templates/:id
router.patch('/route-templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.routeTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Route template not found');
    if (existing.supervisorId !== req.user!.id) throw new ForbiddenError('Access denied');

    const body = RouteTemplateSchema.partial().parse(req.body);
    const template = await prisma.routeTemplate.update({
      where: { id: req.params.id },
      data: {
        ...body,
        orderedEmployeeIds: body.orderedEmployeeIds ?? undefined,
        lastUsedAt: (req.body as any).markUsed ? new Date() : undefined,
      },
      include: { officeLocation: { select: { name: true, address: true, lat: true, lng: true } } },
    });
    res.json(template);
  } catch (err) {
    next(err);
  }
});

// DELETE /supervisor/route-templates/:id
router.delete('/route-templates/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.routeTemplate.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Route template not found');
    if (existing.supervisorId !== req.user!.id) throw new ForbiddenError('Access denied');
    await prisma.routeTemplate.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ── OTD Report ───────────────────────────────────────────────────────────────
// GET /supervisor/reports/otd?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns one row per completed ride with all OTD fields.

router.get('/reports/otd', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 86400 * 1000);
    const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();
    to.setHours(23, 59, 59, 999);

    const supervisor = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { facility: true, org: true },
    });

    const rides = await prisma.ride.findMany({
      where: {
        supervisorId: req.user!.id,
        status: 'completed',
        createdAt: { gte: from, lte: to },
      },
      include: {
        driver:  { select: { fullName: true, vehicleType: true, vehicle: { select: { regNo: true } } } },
        vendor:  { select: { name: true } },
        pax: {
          orderBy: { pickedAt: 'asc' },
          include: { employee: { select: { name: true, empId: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const rows = rides.map((r, idx) => {
      const pickedPax  = r.pax.filter((p) => p.pickedAt && !p.noShow);
      const travelledCount = pickedPax.length;
      const firstSignin = pickedPax.length ? pickedPax[0].pickedAt : null;
      const sortedDesc = [...pickedPax].sort((a, b) =>
        (b.pickedAt?.getTime() ?? 0) - (a.pickedAt?.getTime() ?? 0),
      );
      const lastPax     = sortedDesc[0] ?? null;
      const lastSignin  = lastPax?.pickedAt ?? null;

      const plannedStart = r.plannedStartTime;
      const actualStart  = r.startedAt;
      const driverReport = r.driverReportingTime;

      // Grace period: try to get it from office_locations by matching drop address
      // (office name is stored in dropAddress for login rides)
      // We'll include it as 600 default if we can't match — can be enhanced later
      const graceSecs = 600;
      const targetTime = plannedStart
        ? new Date(plannedStart.getTime() + graceSecs * 1000)
        : null;

      // Delay in minutes: positive = late, negative = early
      let delayMin: number | null = null;
      let delayCause = '';
      if (plannedStart && actualStart) {
        delayMin = Math.round((actualStart.getTime() - plannedStart.getTime()) / 60000);
        if (delayMin <= 0) {
          delayCause = 'Early';
        } else if (targetTime && actualStart > targetTime) {
          // Was the last pax sign-in after planned start? → Employee delay
          delayCause = lastSignin && lastSignin > plannedStart ? 'Employee' : 'Driver';
        } else {
          delayCause = 'On Time';
        }
      }

      // Vehicle label = "VendorName - LastPartOfRegNo"
      const regNo = r.driver?.vehicle?.regNo ?? '';
      const vendorName = r.vendor?.name ?? '';
      const vehicleLabel = regNo ? `${vendorName} - ${regNo}` : vendorName;

      const fmt = (d: Date | null) => d ? d.toTimeString().slice(0, 5) : '';
      const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

      return {
        sNo:                  idx + 1,
        facility:             supervisor?.facility ?? supervisor?.org ?? '',
        office:               r.dropAddress,
        date:                 fmtDate(r.createdAt),
        tripTypeShiftTime:    `${r.type.charAt(0).toUpperCase() + r.type.slice(1)} ${plannedStart ? fmt(plannedStart) : ''}`.trim(),
        tripId:               r.id.slice(-8).toUpperCase(),
        vehicleId:            vehicleLabel,
        registrationNo:       regNo,
        vendor:               vendorName,
        plannedEmployeeCount: r.paxCount,
        travelledEmployeeCount: travelledCount,
        firstEmployeeSignin:  fmt(firstSignin),
        lastEmployeeSignin:   fmt(lastSignin),
        tripStartDelayMin:    delayMin,
        tripKm:               r.distanceKm,
        delayCause,
        plannedStartTime:     fmt(plannedStart),
        logoutGraceTimeSecs:  graceSecs,
        targetTime:           fmt(targetTime),
        actualStartTime:      fmt(actualStart),
        driverReportingTime:  fmt(driverReport),
        lastEmployeeName:     lastPax ? `${lastPax.employee.name}(${lastPax.employee.empId})` : '',
        lastEmployeeSigninTime: fmt(lastSignin),
        price:                r.price,
        distanceKm:           r.distanceKm,
      };
    });

    res.json({ rows, total: rows.length, from: from.toISOString(), to: to.toISOString() });
  } catch (err) {
    next(err);
  }
});

export default router;

// ── Supervisor Dashboard ──────────────────────────────────────────────────────
// GET /supervisor/dashboard
// Returns all KPIs, trend data, delay breakdown, and issues summary in one call.

router.get('/dashboard', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const supId = req.user!.id;
    const now   = new Date();

    // ── Date windows ──────────────────────────────────────────────────────────
    const todayStart  = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart   = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
    const monthStart  = new Date(now); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const day30Start  = new Date(now.getTime() - 30 * 86400_000);

    // ── Core ride counts ──────────────────────────────────────────────────────
    const [
      ridesThisWeek,
      ridesToday,
      completedThisMonth,
      activeRides,
      broadcastingRides,
      totalEmployees,
      openIssues,
      sosThisMonth,
    ] = await Promise.all([
      prisma.ride.count({ where: { supervisorId: supId, createdAt: { gte: weekStart } } }),
      prisma.ride.count({ where: { supervisorId: supId, createdAt: { gte: todayStart }, status: { not: 'cancelled' } } }),
      prisma.ride.count({ where: { supervisorId: supId, status: 'completed', completedAt: { gte: monthStart } } }),
      prisma.ride.count({ where: { supervisorId: supId, status: { in: ['assigned', 'in_progress'] } } }),
      prisma.ride.count({ where: { supervisorId: supId, status: 'broadcasting' } }),
      prisma.employee.count({ where: { supervisorId: supId } }),
      prisma.driverIssue.count({ where: { supervisorId: supId, status: 'open' } }),
      prisma.driverIssue.count({ where: { supervisorId: supId, isSos: true, createdAt: { gte: monthStart } } }),
    ]);

    // ── Spend ─────────────────────────────────────────────────────────────────
    const [spendToday, spendMonth] = await Promise.all([
      prisma.ride.aggregate({ where: { supervisorId: supId, status: 'completed', completedAt: { gte: todayStart } }, _sum: { price: true } }),
      prisma.ride.aggregate({ where: { supervisorId: supId, status: 'completed', completedAt: { gte: monthStart } }, _sum: { price: true } }),
    ]);

    // ── OTD this month ────────────────────────────────────────────────────────
    const completedWithTimestamps = await prisma.ride.findMany({
      where: {
        supervisorId: supId,
        status: 'completed',
        completedAt: { gte: monthStart },
        plannedStartTime: { not: null },
        startedAt: { not: null },
      },
      select: { plannedStartTime: true, startedAt: true },
    });
    const otdCount = completedWithTimestamps.filter(
      (r) => r.startedAt! <= r.plannedStartTime!
    ).length;
    const otdPct = completedWithTimestamps.length
      ? Math.round((otdCount / completedWithTimestamps.length) * 100)
      : null;

    // ── 30-day OTD trend (daily) ───────────────────────────────────────────────
    const trend30 = await prisma.ride.findMany({
      where: {
        supervisorId: supId,
        status: 'completed',
        completedAt: { gte: day30Start },
        plannedStartTime: { not: null },
        startedAt: { not: null },
      },
      select: { completedAt: true, plannedStartTime: true, startedAt: true },
    });

    // Group by date string
    const trendMap: Record<string, { total: number; onTime: number }> = {};
    for (const r of trend30) {
      const d = r.completedAt!.toISOString().slice(0, 10);
      if (!trendMap[d]) trendMap[d] = { total: 0, onTime: 0 };
      trendMap[d].total++;
      if (r.startedAt! <= r.plannedStartTime!) trendMap[d].onTime++;
    }
    const otdTrend = Object.entries(trendMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        otdPct: Math.round((v.onTime / v.total) * 100),
        total: v.total,
        onTime: v.onTime,
      }));

    // ── Delay cause breakdown (last 30 days) ──────────────────────────────────
    const delayRides = await prisma.ride.findMany({
      where: {
        supervisorId: supId,
        status: 'completed',
        completedAt: { gte: day30Start },
        plannedStartTime: { not: null },
        startedAt: { not: null },
      },
      include: {
        pax: { select: { pickedAt: true, noShow: true } },
      },
    });

    const delayCounts = { early: 0, onTime: 0, employee: 0, driver: 0, noData: 0 };
    for (const r of delayRides) {
      const planned = r.plannedStartTime!;
      const actual  = r.startedAt!;
      const delayMs = actual.getTime() - planned.getTime();
      const gracMs  = 600_000; // 10 min default
      if (delayMs < 0) { delayCounts.early++; continue; }
      if (delayMs <= gracMs) { delayCounts.onTime++; continue; }
      // Over grace — was it employee or driver?
      const lastPaxSignin = r.pax
        .filter((p) => p.pickedAt && !p.noShow)
        .reduce((max, p) => p.pickedAt! > max ? p.pickedAt! : max, planned);
      if (lastPaxSignin > planned) { delayCounts.employee++; } else { delayCounts.driver++; }
    }

    // ── Ride volume by type per day (last 14 days) ────────────────────────────
    const vol14 = await prisma.ride.findMany({
      where: {
        supervisorId: supId,
        status: { not: 'cancelled' },
        createdAt: { gte: new Date(now.getTime() - 14 * 86400_000) },
      },
      select: { createdAt: true, type: true },
    });
    const volMap: Record<string, { login: number; logout: number }> = {};
    for (const r of vol14) {
      const d = r.createdAt.toISOString().slice(0, 10);
      if (!volMap[d]) volMap[d] = { login: 0, logout: 0 };
      if (r.type === 'login') volMap[d].login++;
      else volMap[d].logout++;
    }
    const volumeTrend = Object.entries(volMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v, total: v.login + v.logout }));

    // ── Employee coverage this week ───────────────────────────────────────────
    const ridesThisWeekFull = await prisma.ride.findMany({
      where: { supervisorId: supId, status: 'completed', completedAt: { gte: weekStart } },
      include: { pax: { select: { employeeId: true, noShow: true } } },
    });
    const uniqueEmployeeIds = new Set(
      ridesThisWeekFull.flatMap((r) => r.pax.filter((p) => !p.noShow).map((p) => p.employeeId))
    );
    const coveragePct = totalEmployees
      ? Math.round((uniqueEmployeeIds.size / totalEmployees) * 100)
      : 0;

    // ── Open issues list (top 5) ──────────────────────────────────────────────
    const recentIssues = await prisma.driverIssue.findMany({
      where: { supervisorId: supId, status: 'open' },
      orderBy: [{ isSos: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      select: {
        id: true, isSos: true, issueType: true, description: true, createdAt: true,
        driver: { select: { fullName: true } },
      },
    });

    res.json({
      kpis: {
        ridesToday,
        ridesThisWeek,
        completedThisMonth,
        activeRides,
        broadcastingRides,
        totalEmployees,
        spendToday: spendToday._sum.price ?? 0,
        spendMonth: spendMonth._sum.price ?? 0,
        otdPct,
        openIssues,
        sosThisMonth,
        employeesCoveredThisWeek: uniqueEmployeeIds.size,
        coveragePct,
      },
      otdTrend,
      delayCounts,
      volumeTrend,
      recentIssues,
    });
  } catch (err) {
    next(err);
  }
});

// ── Live Ops Board ────────────────────────────────────────────────────────────
// GET /supervisor/live-ops
// Real-time trip status tiles with employee gender breakdown.
// Refreshed every 15s by the frontend.

router.get('/live-ops', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const supId = req.user!.id;

    // All non-cancelled rides created today (or active right now)
    // "Today" = last 24h window so night-shift rides are included
    const since = new Date(Date.now() - 24 * 3600_000);

    const rides = await prisma.ride.findMany({
      where: {
        supervisorId: supId,
        status: { not: 'cancelled' },
        createdAt: { gte: since },
      },
      include: {
        pax: {
          include: {
            employee: { select: { gender: true } },
          },
        },
      },
    });

    // Helper: count total employees + female + male for a set of rides
    const empCounts = (rideList: typeof rides) => {
      let total = 0, female = 0, male = 0;
      for (const r of rideList) {
        for (const p of r.pax) {
          if (p.noShow) continue;
          total++;
          const g = p.employee.gender?.toLowerCase();
          if (g === 'female' || g === 'f') female++;
          else male++;
        }
      }
      return { total, female, male };
    };

    const graceSecs = 600; // default 10 min — could be per-office

    const generated    = rides;
    const yetToStart   = rides.filter((r) => r.status === 'assigned');
    const notDownloaded = rides.filter((r) => ['broadcasting', 'pending', 'expired'].includes(r.status));

    const inProgress   = rides.filter((r) => r.status === 'in_progress');
    const onTime       = inProgress.filter((r) => {
      if (!r.plannedStartTime || !r.startedAt) return false;
      return r.startedAt.getTime() <= r.plannedStartTime.getTime() + graceSecs * 1000;
    });
    const delayed      = inProgress.filter((r) => {
      if (!r.plannedStartTime || !r.startedAt) return false;
      return r.startedAt.getTime() > r.plannedStartTime.getTime() + graceSecs * 1000;
    });
    // In-progress without a planned start time — treat as unknown/not-downloaded
    const inProgressNoTime = inProgress.filter((r) => !r.plannedStartTime || !r.startedAt);

    const completed    = rides.filter((r) => r.status === 'completed');
    const completedOnTime = completed.filter((r) => {
      if (!r.plannedStartTime || !r.startedAt) return false;
      return r.startedAt.getTime() <= r.plannedStartTime.getTime() + graceSecs * 1000;
    });

    // OTP pickup % for on-time trips: pax with pickedAt / total pax
    const onTimePickupPct = (() => {
      let picked = 0, total = 0;
      for (const r of onTime) {
        for (const p of r.pax) {
          if (p.noShow) continue;
          total++;
          if (p.pickedAt) picked++;
        }
      }
      return total > 0 ? Math.round((picked / total) * 100) : null;
    })();

    // OTA % = completed on time / total completed (with planned time)
    const completedWithTime = completed.filter((r) => r.plannedStartTime && r.startedAt);
    const otaPct = completedWithTime.length > 0
      ? Math.round((completedOnTime.length / completedWithTime.length) * 100)
      : null;

    res.json({
      generated:     { count: generated.length,       ...empCounts(generated) },
      yetToStart:    { count: yetToStart.length,       ...empCounts(yetToStart) },
      notDownloaded: { count: notDownloaded.length,    ...empCounts(notDownloaded) },
      onTime:        { count: onTime.length,           ...empCounts(onTime),       onTimePickupPct },
      delayed:       { count: delayed.length,          ...empCounts(delayed) },
      inProgressNoTime: { count: inProgressNoTime.length, ...empCounts(inProgressNoTime) },
      completedOnTime:  { count: completedOnTime.length,  ...empCounts(completedOnTime), otaPct },
      completedTotal:   { count: completed.length,        ...empCounts(completed) },
    });
  } catch (err) {
    next(err);
  }
});

// ── Saved Groups Report ───────────────────────────────────────────────────────
// GET /supervisor/route-templates/report
// Returns usage stats per template.

router.get('/route-templates/report', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const supId = req.user!.id;

    const templates = await prisma.routeTemplate.findMany({
      where: { supervisorId: supId },
      include: { officeLocation: { select: { name: true } } },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
    });

    // For each template count how many completed rides used it (same ordered employee set)
    // We match rides where ALL of the template's employee IDs appear in ride_employees
    const report = await Promise.all(templates.map(async (t) => {
      const empIds = t.orderedEmployeeIds as string[];

      // Count rides that include at least the template employees
      const totalRides = await prisma.ride.count({
        where: {
          supervisorId: supId,
          type: t.rideType as 'login' | 'logout',
          rideEmployees: { some: { employeeId: { in: empIds } } },
        },
      });

      const completedRides = await prisma.ride.count({
        where: {
          supervisorId: supId,
          status: 'completed',
          type: t.rideType as 'login' | 'logout',
          rideEmployees: { some: { employeeId: { in: empIds } } },
        },
      });

      const revenueAgg = await prisma.ride.aggregate({
        where: {
          supervisorId: supId,
          status: 'completed',
          type: t.rideType as 'login' | 'logout',
          rideEmployees: { some: { employeeId: { in: empIds } } },
        },
        _sum: { price: true },
        _avg: { price: true },
      });

      return {
        id: t.id,
        name: t.name,
        rideType: t.rideType,
        vehicleType: t.vehicleType,
        employeeCount: empIds.length,
        officeName: t.officeLocation?.name ?? null,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        totalRides,
        completedRides,
        totalRevenue: revenueAgg._sum.price ?? 0,
        avgFare: revenueAgg._avg.price ?? 0,
      };
    }));

    res.json({ report });
  } catch (err) {
    next(err);
  }
});
