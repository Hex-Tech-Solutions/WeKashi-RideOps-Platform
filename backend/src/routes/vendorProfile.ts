import { Router, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
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
      select: { id: true, name: true, vendorCode: true },
    });
    if (!vendor) throw new NotFoundError('Vendor profile not found');
    res.json(vendor);
  } catch (err) {
    next(err);
  }
});

export default router;
