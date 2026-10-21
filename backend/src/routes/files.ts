import { Router, Request, Response } from 'express';
import path from 'path';
import { UPLOAD_DIR, USE_AZURE_STORAGE, streamBlobToResponse } from '../lib/storage';
import { verifyAccessToken } from '../lib/jwt';
import { prisma } from '../lib/prisma';
import type { JwtAccessPayload } from '../types';

/**
 * Serves uploaded document files WITH per-object authorization.
 *
 * Auth via Authorization header OR ?token= (so files can render in <img>/<a>
 * from the SPA; browsers can't attach an Authorization header to those).
 *
 * The caller must be allowed to see THIS specific file — previously any valid
 * token of any role/tenant could fetch any file by name, exposing KYC docs and
 * payout invoices. Now we resolve the file to its owning DriverDocument or
 * Payout and enforce:
 *   - admin  → any file
 *   - driver → only their own documents
 *   - vendor → documents of drivers in their fleet, and their own payout files
 *   - supervisor → no file access
 */
const router = Router();

async function canAccess(payload: JwtAccessPayload, filename: string): Promise<boolean> {
  if (payload.role === 'admin') return true;

  const fileUrl = `/api/files/${filename}`;

  // Driver document?
  const doc = await prisma.driverDocument.findFirst({
    where: { fileUrl },
    select: { driverId: true, driver: { select: { vendorId: true } } },
  });
  if (doc) {
    if (payload.role === 'driver') return doc.driverId === payload.sub;
    if (payload.role === 'vendor') {
      const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub }, select: { id: true } });
      return !!vendor && doc.driver?.vendorId === vendor.id;
    }
    return false;
  }

  // Payout invoice/proof?
  const payout = await prisma.payout.findFirst({ where: { fileUrl }, select: { vendorId: true } });
  if (payout) {
    if (payload.role === 'vendor') {
      const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub }, select: { id: true } });
      return !!vendor && payout.vendorId === vendor.id;
    }
    return false;
  }

  // File is not referenced by any record we know of — deny (fail closed).
  return false;
}

router.get('/:filename', async (req: Request, res: Response) => {
  // ── Auth: verify the token first ──────────────────────────────────────────
  const token =
    (req.query.token as string | undefined) ??
    (req.headers.authorization ?? '').replace('Bearer ', '');
  let payload: JwtAccessPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  // Sanitize filename — prevent path traversal
  const filename = path.basename(req.params.filename);

  // ── Per-object authorization ───────────────────────────────────────────────
  try {
    if (!(await canAccess(payload, filename))) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    return;
  }

  // Private — never cache a KYC/payout file in a shared proxy.
  res.setHeader('Cache-Control', 'private, no-store');

  // ── Azure Blob Storage (production) ─────────────────────────────────────
  if (USE_AZURE_STORAGE) {
    await streamBlobToResponse(filename, res);
    return;
  }

  // ── Local disk (development) ─────────────────────────────────────────────
  res.sendFile(path.join(UPLOAD_DIR, filename), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found', code: 'NOT_FOUND' });
  });
});

export default router;
