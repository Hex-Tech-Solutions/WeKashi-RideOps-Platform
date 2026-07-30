import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import { createPayout, listPayouts, markPayoutPaid, countCompletedRides, attachPayoutFile } from '../services/payout.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { upload } from '../lib/storage';
import type { AuthRequest } from '../types';

const router = Router();

const CreatePayoutSchema = z.object({
  vendorId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM format'),
  amount: z.number().positive().optional(),
  ratePerRide: z.number().positive().optional(),
}).refine((b) => b.amount != null || b.ratePerRide != null, {
  message: 'Provide either amount or ratePerRide',
});

router.use(authenticate);

// GET /payouts
router.get('/', requireRole('vendor', 'admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    const status = req.query.status as string | undefined;

    let vendorId: string | undefined;
    if (req.user?.role === 'vendor') {
      const { prisma } = await import('../lib/prisma');
      const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
      vendorId = vendor?.id;
    } else {
      vendorId = req.query.vendorId as string | undefined;
    }

    const result = await listPayouts({ vendorId, status, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /payouts/ride-count?vendorId=&period=YYYY-MM — admin previews payout basis
router.get('/ride-count', requireRole('admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const vendorId = req.query.vendorId as string;
    const period = req.query.period as string | undefined;
    if (!vendorId) { res.status(400).json({ error: 'vendorId required' }); return; }
    const rides = await countCompletedRides(vendorId, period);
    res.json({ vendorId, period: period ?? null, rides });
  } catch (err) {
    next(err);
  }
});

// POST /payouts — admin only. Accepts JSON or multipart (optional invoice/proof file).
router.post('/', requireRole('admin'), upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Multipart sends numbers as strings — coerce before validating.
    const raw = {
      vendorId: req.body.vendorId,
      period: req.body.period,
      amount: req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : undefined,
      ratePerRide: req.body.ratePerRide != null && req.body.ratePerRide !== '' ? Number(req.body.ratePerRide) : undefined,
    };
    const body = CreatePayoutSchema.parse(raw);
    const fileUrl = req.file ? `/api/files/${req.file.filename}` : undefined;
    const payout = await createPayout({ ...body, fileUrl });
    res.status(201).json(payout);
  } catch (err) {
    next(err);
  }
});

// PATCH /payouts/:id/file — admin manually attaches an invoice/proof file
router.patch('/:id/file', requireRole('admin'), upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'A file is required' }); return; }
    const payout = await attachPayoutFile(req.params.id, `/api/files/${req.file.filename}`);
    res.json(payout);
  } catch (err) {
    next(err);
  }
});

// PATCH /payouts/:id/status — admin marks paid
router.patch('/:id/status', requireRole('admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payout = await markPayoutPaid(req.params.id);
    res.json(payout);
  } catch (err) {
    next(err);
  }
});

export default router;
