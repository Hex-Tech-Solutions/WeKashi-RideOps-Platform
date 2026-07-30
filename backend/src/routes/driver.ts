import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import {
  getDriver,
  listDriverOffers,
  updateDriverLocation,
  setDriverOnlineStatus,
} from '../services/driver.service';
import { addDriverDocument, listDriverDocuments, deleteDriverDocument } from '../services/document.service';
import { upload, USE_AZURE_STORAGE, uploadToAzureBlob } from '../lib/storage';

// Helper: after multer processes a file, get its final URL (local path or Azure Blob)
async function resolveFileUrl(file: Express.Multer.File): Promise<string> {
  if (USE_AZURE_STORAGE) {
    return uploadToAzureBlob(file.buffer, file.originalname, file.mimetype);
  }
  return `/api/files/${file.filename}`;
}
import { listRides, listScheduledRidesForDriver } from '../services/ride.service';
import type { AuthRequest } from '../types';
import type { Server as IoServer } from 'socket.io';

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export function createDriverRouter(io: IoServer): Router {
  const router = Router();

  router.use(authenticate);
  router.use(requireRole('driver'));

// GET /api/driver/me
router.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getDriver(req.driver!.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/offers — broadcasting rides I can accept
router.get('/offers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ offers: await listDriverOffers(req.driver!.id) });
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/rides — my assigned/active/past rides
router.get('/rides', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    res.json(await listRides({ role: 'driver', driverId: req.driver!.id, vendorId: req.driver!.vendorId, page, limit }));
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/scheduled — scheduled-ride marketplace (matching vehicle type)
router.get('/scheduled', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../lib/prisma');
    const d = await prisma.driver.findUnique({ where: { id: req.driver!.id }, select: { vehicleType: true } });
    res.json({ scheduled: await listScheduledRidesForDriver(d?.vehicleType) });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/online — sets location + marks online (eligible for broadcasts)
router.post('/online', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng } = LocationSchema.parse(req.body);
    await updateDriverLocation(req.driver!.id, lat, lng, io);
    res.json({ isOnline: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/location — periodic live GPS ping while online
router.post('/location', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng } = LocationSchema.parse(req.body);
    await updateDriverLocation(req.driver!.id, lat, lng, io);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/offline
router.post('/offline', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await setDriverOnlineStatus(req.driver!.id, false);
    res.json({ isOnline: false });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/vehicle — set vehicle type + seats (used for radius matching)
router.post('/vehicle', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { vehicleType, seats } = z
      .object({ vehicleType: z.enum(['hatchback', 'sedan', 'suv']), seats: z.number().int().min(1).max(20) })
      .parse(req.body);
    const { prisma } = await import('../lib/prisma');
    const d = await prisma.driver.update({ where: { id: req.driver!.id }, data: { vehicleType, seats } });
    res.json({ vehicleType: d.vehicleType, seats: d.seats });
  } catch (err) {
    next(err);
  }
});

// ─── KYC / vehicle documents ─────────────────────────────────────────────────

// GET /api/driver/documents
router.get('/documents', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ documents: await listDriverDocuments(req.driver!.id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/documents — multipart (field "file" + type/number/expiry)
router.post('/documents', upload.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'A file is required', code: 'VALIDATION_ERROR' });
      return;
    }
    const { type, number, expiry } = req.body as { type?: string; number?: string; expiry?: string };
    if (!type) {
      res.status(400).json({ error: 'Document type is required', code: 'VALIDATION_ERROR' });
      return;
    }
    const doc = await addDriverDocument(req.driver!.id, {
      type,
      fileUrl: await resolveFileUrl(req.file),
      number: number || undefined,
      expiry: expiry ? new Date(expiry) : undefined,
    });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/driver/documents/:id
router.delete('/documents/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await deleteDriverDocument(req.params.id, req.driver!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

  return router;
}

// Legacy default export for backward compat — uses a no-op io stub
import { createServer } from 'http';
const _stub = { of: () => ({ to: () => ({ emit: () => {} }) }) } as any;
export default createDriverRouter(_stub);
