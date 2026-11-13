import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import {
  getDriver,
  listDriverOffers,
  countDriverOffers,
  updateDriverLocation,
  setDriverOnlineStatus,
} from '../services/driver.service';
import { addDriverDocument, listDriverDocuments, deleteDriverDocument, assertCanUploadDocument } from '../services/document.service';
import fs from 'fs';
import { upload, USE_AZURE_STORAGE, uploadToAzureBlob } from '../lib/storage';
import { validateDocDetails, DOC_TYPE_RULES } from '../lib/documentTypes';
import {
  requireIndianMobile, normalizeIndianMobile, normalizeDl, normalizeAadhaar, maskAadhaar,
  isMaskedAadhaar, hashAadhaar, assertNoIdentityConflict, flagPossibleDuplicate,
  IDENTITY_CONFLICT_MESSAGE,
} from '../lib/identity';
import { ValidationError, ConflictError } from '../types';
import { logger } from '../lib/logger';

/**
 * Identity rules for document numbers. Returns the number to store.
 *  - Aadhaar: must match the Aadhaar on the driver's profile; stored MASKED.
 *  - DL: must match the profile DL number.
 *  - RC: the registration number must not belong to another driver/vehicle.
 */
async function checkDocumentIdentity(driverId: string, type: string, number?: string): Promise<string | undefined> {
  if (!number) return number;
  const { prisma } = await import('../lib/prisma');

  if (type === 'aadhaar') {
    const aadhaar = normalizeAadhaar(number);
    if (!aadhaar) throw new ValidationError('Aadhaar number must be 12 digits');
    const me = await prisma.driver.findUnique({ where: { id: driverId }, select: { govIdHash: true, govIdNumber: true } });
    const legacyDigits = me?.govIdNumber?.replace(/\D/g, '') ?? '';
    const matches = me?.govIdHash ? me.govIdHash === hashAadhaar(aadhaar) : legacyDigits === aadhaar;
    if (!me?.govIdHash && legacyDigits.length !== 12) {
      throw new ValidationError('Add your Aadhaar number in Profile first, then upload the card');
    }
    if (!matches) throw new ValidationError('This Aadhaar number does not match the one in your profile');
    return maskAadhaar(aadhaar);
  }

  if (type === 'dl') {
    const dl = normalizeDl(number);
    const me = await prisma.driver.findUnique({ where: { id: driverId }, select: { dlNumber: true } });
    if (!me?.dlNumber) throw new ValidationError('Add your driving licence number in Profile first, then upload the licence');
    if (normalizeDl(me.dlNumber) !== dl) {
      throw new ValidationError('This licence number does not match the one in your profile');
    }
    return dl;
  }

  if (type === 'rc') {
    const reg = normalizeDl(number); // same rule: uppercase letters + digits
    const taken = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT d.id FROM driver_documents doc
      JOIN drivers d ON d.id = doc.driver_id
      WHERE doc.type = 'rc' AND d.id <> ${driverId} AND d.status <> 'removed'
        AND upper(regexp_replace(coalesce(doc.number, ''), '[^A-Za-z0-9]', '', 'g')) = ${reg}
      UNION
      SELECT d.id FROM vehicles v
      JOIN drivers d ON d.vehicle_id = v.id
      WHERE d.id <> ${driverId} AND d.status <> 'removed'
        AND upper(regexp_replace(v.reg_no, '[^A-Za-z0-9]', '', 'g')) = ${reg}
      LIMIT 1
    `;
    if (taken.length > 0) {
      logger.warn({ context: 'rc-upload', existingDriverId: taken[0].id, editingDriverId: driverId }, 'Duplicate identity blocked');
      throw new ConflictError(IDENTITY_CONFLICT_MESSAGE);
    }
    return reg;
  }

  return number;
}

// Helper: after multer processes a file, get its final URL (local path or Azure Blob)
async function resolveFileUrl(file: Express.Multer.File): Promise<string> {
  if (USE_AZURE_STORAGE) {
    return uploadToAzureBlob(file.buffer, file.originalname, file.mimetype);
  }
  return `/api/files/${file.filename}`;
}
import { listRides, listScheduledRidesForDriver } from '../services/ride.service';
import { listPackCatalog } from '../lib/creditPacks';
import { availableCredits, listPacks, getDriverStats } from '../services/creditPack.service';
import { createOrder, confirmAndActivate } from '../services/packOrder.service';
import { saveAndValidateVpa } from '../services/vpa.service';
import {
  setRentalOptIn,
  listEligibleRentalsForDriver,
  listDriverRentals,
  listDriverRentalHistory,
  markRentalReceived,
  acceptRental,
  releaseRental,
  rentalArrived,
  startRental,
  agreeRentalOverage,
  completeRental,
  closeRentalNoShow,
  dismissRentalForDriver,
  getRentalProgress,
  logRentalLocation,
} from '../services/rental.service';
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

// POST /api/driver/push-token — register this device's FCM token so the driver
// receives ride-broadcast pushes when the app is backgrounded/killed. Called by
// the app after login once the push permission is granted. Idempotent.
const PushTokenSchema = z.object({ token: z.string().min(10).max(4096) });
router.post('/push-token', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { token } = PushTokenSchema.parse(req.body);
    const { prisma } = await import('../lib/prisma');
    // A token is unique per device install. Clear it from any OTHER driver first
    // (shared device / account switch) so a broadcast never pushes to the wrong
    // person, then assign it to the current driver.
    // Same device on another account = possible duplicate person. Flag it for
    // admins (never block — families share phones), then move the token.
    const others = await prisma.driver.findMany({
      where: { fcmToken: token, NOT: { id: req.driver!.id }, status: { not: 'removed' } },
      select: { id: true },
    });
    for (const o of others) {
      await flagPossibleDuplicate({
        kind: 'shared_device',
        driverId: req.driver!.id,
        otherDriverId: o.id,
        detail: 'Same device signed into both accounts',
      });
    }
    await prisma.driver.updateMany({
      where: { fcmToken: token, NOT: { id: req.driver!.id } },
      data: { fcmToken: null },
    });
    await prisma.driver.update({ where: { id: req.driver!.id }, data: { fcmToken: token } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/driver/push-token — clear this driver's token (on logout, so a
// signed-out device stops receiving pushes).
router.delete('/push-token', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../lib/prisma');
    await prisma.driver.update({ where: { id: req.driver!.id }, data: { fcmToken: null } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/offers — broadcasting rides I can accept.
// `offers` is capped (see MAX_DRIVER_OFFERS) so the list stays scrollable
// instead of growing unbounded; `totalCount` is the uncapped total, used to
// show "N available" on the Rides tab even when more exist than are listed.
router.get('/offers', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [offers, totalCount] = await Promise.all([
      listDriverOffers(req.driver!.id),
      countDriverOffers(req.driver!.id),
    ]);
    res.json({ offers, totalCount });
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
    const scheduled = await listScheduledRidesForDriver(d?.vehicleType);
    // Strip supervisor-relayed OTPs (escort/airport) from the driver marketplace.
    const { stripRideListForDriver } = await import('../lib/rideSanitize');
    res.json({ scheduled: stripRideListForDriver(scheduled as Record<string, unknown>[]) });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/online — sets location + marks online (eligible for broadcasts)
router.post('/online', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { lat, lng } = LocationSchema.parse(req.body);
    // Flip the DB flag + seed the heartbeat immediately — don't wait up to 60s
    // for the location flush, otherwise the driver appears offline to matching
    // right after going online.
    await setDriverOnlineStatus(req.driver!.id, true);
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

// PATCH /api/driver/profile — update personal / licence details
router.patch('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ProfileSchema = z.object({
      fullName:    z.string().min(2).max(100).optional(),
      altPhone:    z.string().min(10).max(15).optional().nullable(),
      dlNumber:    z.string().max(20).optional().nullable(),
      dlExpiry:    z.string().datetime().optional().nullable(),   // ISO date string
      govIdNumber: z.string().max(30).optional().nullable(),
    });
    const body = ProfileSchema.parse(req.body);
    const { prisma } = await import('../lib/prisma');
    const driverId = req.driver!.id;
    const me = await prisma.driver.findUnique({ where: { id: driverId }, select: { phone: true } });

    // Normalise every identity field and reject anything already in use.
    const data: Record<string, unknown> = {};
    const keys: Record<string, string | null> = {};

    if (body.fullName !== undefined) data.fullName = body.fullName.trim();

    if (body.altPhone !== undefined) {
      if (!body.altPhone || !body.altPhone.trim()) {
        data.altPhone = null;
      } else {
        const alt = requireIndianMobile(body.altPhone, 'Alternate phone');
        if (me && normalizeIndianMobile(me.phone) === alt) {
          throw new ValidationError('Alternate phone must be different from your main phone');
        }
        data.altPhone = alt;
        keys.altPhone = alt;
      }
    }

    if (body.dlNumber !== undefined) {
      const dl = body.dlNumber ? normalizeDl(body.dlNumber) : '';
      if (dl && (dl.length < 6 || dl.length > 20)) throw new ValidationError('Enter a valid driving licence number');
      data.dlNumber = dl || null;
      if (dl) keys.dlNumber = dl;
    }
    if (body.dlExpiry !== undefined) data.dlExpiry = body.dlExpiry ? new Date(body.dlExpiry) : null;

    // Aadhaar: never stored in full — keyed hash for matching + masked display.
    // The app sends the masked value back unchanged, which means "no change".
    if (body.govIdNumber !== undefined && !(body.govIdNumber && isMaskedAadhaar(body.govIdNumber))) {
      if (!body.govIdNumber || !body.govIdNumber.trim()) {
        data.govIdNumber = null;
        data.govIdHash = null;
      } else {
        const aadhaar = normalizeAadhaar(body.govIdNumber);
        if (!aadhaar) throw new ValidationError('Aadhaar number must be 12 digits');
        data.govIdNumber = maskAadhaar(aadhaar);
        data.govIdHash = hashAadhaar(aadhaar);
        keys.aadhaar = aadhaar;
      }
    }

    await assertNoIdentityConflict(keys, driverId, 'profile');

    const d = await prisma.driver.update({
      where: { id: driverId },
      data,
      select: { id: true, fullName: true, phone: true, altPhone: true, dlNumber: true, dlExpiry: true, govIdNumber: true },
    });
    res.json(d);
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
    // Each type must carry its required number / expiry (see lib/documentTypes).
    const detailError = validateDocDetails(type, number, expiry);
    if (detailError) {
      res.status(400).json({ error: detailError, code: 'VALIDATION_ERROR' });
      return;
    }
    // Checks before storing the file anywhere permanent:
    //  - a verified document is locked until it nears expiry or is rejected;
    //  - the document number must match the driver's own profile and not
    //    belong to anyone else (zero-tolerance duplicates).
    let storedNumber = number?.trim() || undefined;
    try {
      await assertCanUploadDocument(req.driver!.id, type);
      storedNumber = await checkDocumentIdentity(req.driver!.id, type, storedNumber);
    } catch (e) {
      // Local disk mode has already written the file — remove it.
      if (!USE_AZURE_STORAGE && req.file.path) fs.promises.unlink(req.file.path).catch(() => undefined);
      throw e;
    }
    const rule = DOC_TYPE_RULES[type];
    const doc = await addDriverDocument(req.driver!.id, {
      type,
      fileUrl: await resolveFileUrl(req.file),
      number: storedNumber,
      // Only store an expiry for types that have one.
      expiry: rule.needsExpiry && expiry ? new Date(expiry) : undefined,
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

// ─── Ride credits + pack purchase ─────────────────────────────────────────────

// GET /api/driver/packs/catalog — the three purchasable packs (Req 5.3)
router.get('/packs/catalog', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ packs: listPackCatalog() });
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/stats — earnings dashboard (earnings, trips, credits, expenses, profit)
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await getDriverStats(req.driver!.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/credits — total available + per-pack breakdown (Req 8.3)
router.get('/credits', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const [available, packs] = await Promise.all([
      availableCredits(req.driver!.id),
      listPacks(req.driver!.id),
    ]);
    res.json({ available, packs });
  } catch (err) {
    next(err);
  }
});

// GET /api/driver/purchases — this driver's own successful pack purchases,
// newest first. Scoped to req.driver.id, so a driver only ever sees their own.
router.get('/purchases', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { prisma } = await import('../lib/prisma');
    const orders = await prisma.packOrder.findMany({
      where: { driverId: req.driver!.id, status: 'paid' },
      orderBy: { paidAt: 'desc' },
      take: 100,
      select: {
        id: true, packKey: true, credits: true, amount: true, status: true,
        gatewayOrderId: true, paidAt: true, createdAt: true,
      },
    });
    res.json({ purchases: orders });
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/packs/order — create a Cashfree order for a pack (Req 6.1)
router.post('/packs/order', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { packKey } = z.object({ packKey: z.string().min(1) }).parse(req.body);
    res.json(await createOrder(req.driver!.id, packKey));
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/packs/verify — confirm via Cashfree order status + activate
// (Req 6.2-6.4). No client signature — the server fetches the authoritative
// order status and only activates when it is PAID.
router.post('/packs/verify', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orderId } = z.object({ orderId: z.string().min(1) }).parse(req.body);
    const result = await confirmAndActivate(orderId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/driver/upi — validate + save a payable UPI VPA (Req 13)
router.post('/upi', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { vpa } = z.object({ vpa: z.string().min(3).max(256) }).parse(req.body);
    res.json(await saveAndValidateVpa(req.driver!.id, vpa));
  } catch (err) {
    next(err);
  }
});

  // ── Rentals ─────────────────────────────────────────────────────────────────

  // POST /api/driver/rental-opt-in — enable/disable receiving rental bookings
  router.post('/rental-opt-in', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { optIn } = z.object({ optIn: z.boolean() }).parse(req.body);
      res.json(await setRentalOptIn(req.driver!.id, optIn));
    } catch (err) {
      next(err);
    }
  });

  // GET /api/driver/rentals/available — eligible rental bookings to accept
  router.get('/rentals/available', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ rentals: await listEligibleRentalsForDriver(req.driver!.id) });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/driver/rentals/mine — rentals this driver currently holds
  router.get('/rentals/mine', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ rentals: await listDriverRentals(req.driver!.id) });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/driver/rentals/history — completed rentals for the trip history
  router.get('/rentals/history', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json({ rentals: await listDriverRentalHistory(req.driver!.id) });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/received — driver confirms payment received
  router.post('/rentals/:id/received', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await markRentalReceived(req.params.id, req.driver!.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/accept — claim a rental (burns one credit)
  router.post('/rentals/:id/accept', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await acceptRental(req.params.id, req.driver!.id));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/release — cancel a rental (refunds the credit)
  router.post('/rentals/:id/release', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      res.json(await releaseRental(req.params.id, req.driver!.id));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/arrived — driver confirms arrival at pickup
  router.post('/rentals/:id/arrived', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await rentalArrived(req.params.id, req.driver!.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/start — driver enters pickup OTP (timer starts)
  router.post('/rentals/:id/start', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { otp } = z.object({ otp: z.string().min(4).max(6) }).parse(req.body);
      res.json(await startRental(req.params.id, req.driver!.id, otp));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/agree-overage — driver accepts the overage pop-up
  router.post('/rentals/:id/agree-overage', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await agreeRentalOverage(req.params.id, req.driver!.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/complete — driver enters drop OTP (billing stops)
  router.post('/rentals/:id/complete', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { otp } = z.object({ otp: z.string().min(4).max(6) }).parse(req.body);
      res.json(await completeRental(req.params.id, req.driver!.id, otp));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/no-show — customer never showed; close at half
  // fare. The supervisor's rental list polls every 15s, so the no-show banner +
  // half-fare total surface there automatically (no socket push needed).
  router.post('/rentals/:id/no-show', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { total } = await closeRentalNoShow(req.params.id, req.driver!.id);
      res.json({ ok: true, total });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/dismiss — hide a broadcasting rental for this
  // driver (persists across refresh; does not affect other drivers).
  router.post('/rentals/:id/dismiss', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      await dismissRentalForDriver(req.driver!.id, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/driver/rentals/:id/progress — live timer/distance/overage
  router.get('/rentals/:id/progress', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Ownership guard — a driver may only read progress for a rental they
      // hold. Without this, any driver could read any rental's live timing,
      // distance and billing by guessing an id.
      const { prisma } = await import('../lib/prisma');
      const owned = await prisma.rental.findFirst({
        where: { id: req.params.id, driverId: req.driver!.id },
        select: { id: true },
      });
      if (!owned) { res.status(404).json({ error: 'Rental not found', code: 'NOT_FOUND' }); return; }
      res.json(await getRentalProgress(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/driver/rentals/:id/location — GPS breadcrumb for the odometer
  router.post('/rentals/:id/location', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { lat, lng } = LocationSchema.parse(req.body);
      await logRentalLocation(req.params.id, req.driver!.id, lat, lng);
      res.json({ ok: true });
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
