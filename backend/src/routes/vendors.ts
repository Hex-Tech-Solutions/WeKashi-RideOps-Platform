import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import {
  createVendor,
  listVendors,
  getVendor,
  updateVendor,
  deleteVendor,
  getVendorStats,
} from '../services/vendor.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import type { AuthRequest } from '../types';

const router = Router();

const VendorSchema = z.object({
  name: z.string().min(2).max(100),
  contactName: z.string().min(2).max(100),
  contactPhone: z.string().min(10).max(15),
  contactEmail: z.string().email(),
  payoutDetails: z.record(z.unknown()).optional(),
  userId: z.string().uuid(), // admin provides the userId, but we validate role server-side
});

const UpdateVendorSchema = VendorSchema.omit({ userId: true }).partial();

router.use(authenticate);
router.use(requireRole('admin'));

// GET /vendors
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    const result = await listVendors(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /vendors — admin only, validates target user has vendor role
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = VendorSchema.parse(req.body);
    // Validate the target userId has role 'vendor' — prevents linking to admin/supervisor
    const { prisma } = await import('../lib/prisma');
    const targetUser = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, role: true },
    });
    if (!targetUser) {
      res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' }); return;
    }
    if (targetUser.role !== 'vendor') {
      res.status(400).json({ error: 'Target user must have vendor role', code: 'VALIDATION_ERROR' }); return;
    }
    const vendor = await createVendor(body);
    res.status(201).json(vendor);
  } catch (err) {
    next(err);
  }
});

// GET /vendors/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await getVendor(req.params.id);
    res.json(vendor);
  } catch (err) {
    next(err);
  }
});

// PATCH /vendors/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = UpdateVendorSchema.parse(req.body);
    const vendor = await updateVendor(req.params.id, body);
    res.json(vendor);
  } catch (err) {
    next(err);
  }
});

// DELETE /vendors/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await deleteVendor(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /vendors/:id/stats
router.get('/:id/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stats = await getVendorStats(req.params.id);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

export default router;
