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
} from '../services/admin.service';
import type { AuthRequest } from '../types';

const router = Router();

router.use(authenticate);
router.use(requireRole('admin'));

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
