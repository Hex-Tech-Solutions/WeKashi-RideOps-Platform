import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import {
  createVehicle,
  listVehicles,
  getVehicle,
  updateVehicle,
  deleteVehicle,
} from '../services/vehicle.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import type { AuthRequest } from '../types';

const router = Router();

const VehicleSchema = z.object({
  regNo: z.string().min(2).max(20),
  capacity: z.number().int().positive().max(50),
  fuelType: z.string().min(1).max(20),
  documents: z.record(z.unknown()).optional(),
});

const UpdateVehicleSchema = VehicleSchema.omit({ regNo: true }).partial();

router.use(authenticate);
router.use(requireRole('vendor', 'admin'));

// GET /vehicles
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit);

    const { prisma } = await import('../lib/prisma');
    let vendorId: string;

    if (req.user?.role === 'vendor') {
      const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
      if (!vendor) {
        res.status(400).json({ error: 'Vendor not found', code: 'NOT_FOUND' });
        return;
      }
      vendorId = vendor.id;
    } else {
      vendorId = req.query.vendorId as string;
      if (!vendorId) {
        res.status(400).json({ error: 'vendorId query param required for admin', code: 'VALIDATION_ERROR' });
        return;
      }
    }

    const result = await listVehicles(vendorId, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /vehicles
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'vendor') {
      res.status(403).json({ error: 'Only vendors can create vehicles', code: 'FORBIDDEN' });
      return;
    }

    const { prisma } = await import('../lib/prisma');
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
    if (!vendor) {
      res.status(400).json({ error: 'Vendor not found', code: 'NOT_FOUND' });
      return;
    }

    const body = VehicleSchema.parse(req.body);
    const vehicle = await createVehicle({ ...body, vendorId: vendor.id });
    res.status(201).json(vehicle);
  } catch (err) {
    next(err);
  }
});

// GET /vehicles/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let vendorId: string | undefined;
    if (req.user?.role === 'vendor') {
      const { prisma } = await import('../lib/prisma');
      const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
      vendorId = vendor?.id;
    }
    const vehicle = await getVehicle(req.params.id, vendorId);
    res.json(vehicle);
  } catch (err) {
    next(err);
  }
});

// PATCH /vehicles/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'vendor') {
      res.status(403).json({ error: 'Only vendors can update vehicles', code: 'FORBIDDEN' });
      return;
    }

    const { prisma } = await import('../lib/prisma');
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
    if (!vendor) {
      res.status(400).json({ error: 'Vendor not found', code: 'NOT_FOUND' });
      return;
    }

    const body = UpdateVehicleSchema.parse(req.body);
    const vehicle = await updateVehicle(req.params.id, vendor.id, body);
    res.json(vehicle);
  } catch (err) {
    next(err);
  }
});

// DELETE /vehicles/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.role !== 'vendor') {
      res.status(403).json({ error: 'Only vendors can delete vehicles', code: 'FORBIDDEN' });
      return;
    }

    const { prisma } = await import('../lib/prisma');
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
    if (!vendor) {
      res.status(400).json({ error: 'Vendor not found', code: 'NOT_FOUND' });
      return;
    }

    await deleteVehicle(req.params.id, vendor.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
