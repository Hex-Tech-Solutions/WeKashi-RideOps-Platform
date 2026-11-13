import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import {
  createTenant,
  listTenants,
  setTenantActive,
  createVendorAccount,
  listRegistrationRequests,
  reviewRegistrationRequest,
  packSalesReport,
} from '../services/admin.service';
import type { AuthRequest } from '../types';

const router = Router();

router.use(authenticate);
router.use(requireRole('admin'));

// GET /admin/pack-sales?from&to — pack revenue rows + aggregates (Req 15)
router.get('/pack-sales', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { from, to } = z
      .object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() })
      .parse({ from: req.query.from, to: req.query.to });
    res.json(await packSalesReport(from ? new Date(from) : undefined, to ? new Date(to) : undefined));
  } catch (err) {
    next(err);
  }
});

const TenantSchema = z.object({
  company: z.string().min(2).max(100),
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

const VendorSchema = z.object({
  company: z.string().min(2).max(100),
  contactName: z.string().min(2).max(100),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(10).max(15),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

// ─── Possible duplicate accounts (soft flags, never block) ──────────────────

// GET /admin/identity-flags?status=open|all
router.get('/identity-flags', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../lib/prisma');
    const openOnly = req.query.status !== 'all';
    const flags = await prisma.identityFlag.findMany({
      where: openOnly ? { resolvedAt: null } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const ids = [...new Set(flags.flatMap((f) => [f.driverId, f.otherDriverId]))];
    const drivers = await prisma.driver.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, phone: true, status: true, vendor: { select: { name: true } } },
    });
    const byId = new Map(drivers.map((d) => [d.id, d]));
    res.json({
      flags: flags.map((f) => ({ ...f, driver: byId.get(f.driverId) ?? null, otherDriver: byId.get(f.otherDriverId) ?? null })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/identity-flags/:id/resolve — mark a flag as reviewed
router.post('/identity-flags/:id/resolve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../lib/prisma');
    await prisma.identityFlag.update({ where: { id: req.params.id }, data: { resolvedAt: new Date() } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── Tenants (company + supervisor) ─────────────────────────────────────────

router.get('/tenants', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ tenants: await listTenants() });
  } catch (err) {
    next(err);
  }
});

router.post('/tenants', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = TenantSchema.parse(req.body);
    res.status(201).json(await createTenant(body));
  } catch (err) {
    next(err);
  }
});

router.patch('/tenants/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
    res.json(await setTenantActive(req.params.id, isActive));
  } catch (err) {
    next(err);
  }
});

// ─── Vendors (company + vendor login) ───────────────────────────────────────

router.post('/vendors', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = VendorSchema.parse(req.body);
    res.status(201).json(await createVendorAccount(body));
  } catch (err) {
    next(err);
  }
});

// ─── Registration requests ────────────────────────────────────────────────────

router.get('/registration-requests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const requests = await listRegistrationRequests(status);
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

router.patch('/registration-requests/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { decision, reviewNote } = z.object({
      decision:   z.enum(['approved', 'rejected']),
      reviewNote: z.string().max(300).optional(),
    }).parse(req.body);
    const result = await reviewRegistrationRequest(req.params.id, decision, reviewNote);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
