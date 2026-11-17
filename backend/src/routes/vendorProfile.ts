import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { zIndianMobile } from '../lib/identity';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { NotFoundError } from '../types';
import type { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);
router.use(requireRole('vendor'));

/**
 * GET /api/vendor/profile
 * Returns the current vendor user's own vendor record (id, name, vendorCode).
 * Used by the vendor layout/dashboard to display the vendor code prominently.
 */
router.get('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user!.id },
      select: { id: true, name: true, vendorCode: true, contactName: true, contactPhone: true, contactEmail: true },
    });
    if (!vendor) throw new NotFoundError('Vendor profile not found');
    res.json(vendor);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/vendor/profile — the vendor edits their own company name and
 * contact details (Settings page). The vendor code can't be changed.
 */
router.patch('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.object({
      name: z.string().trim().min(2).max(100).optional(),
      contactName: z.string().trim().min(2).max(100).optional(),
      contactPhone: zIndianMobile('Contact phone').optional(),
      contactEmail: z.string().trim().email().max(200).optional(),
    }).parse(req.body);
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!vendor) throw new NotFoundError('Vendor profile not found');
    const updated = await prisma.vendor.update({
      where: { id: vendor.id },
      data: body,
      select: { id: true, name: true, vendorCode: true, contactName: true, contactPhone: true, contactEmail: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
