import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { UPLOAD_DIR } from '../lib/storage';
import { NotFoundError, ForbiddenError, ValidationError } from '../types';

export async function addDriverDocument(
  driverId: string,
  input: { type: string; fileUrl: string; number?: string; expiry?: Date },
) {
  return prisma.driverDocument.create({
    data: {
      driverId,
      type: input.type,
      fileUrl: input.fileUrl,
      number: input.number,
      expiry: input.expiry,
    },
  });
}

export async function listDriverDocuments(driverId: string) {
  return prisma.driverDocument.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
}

export async function deleteDriverDocument(id: string, driverId: string) {
  const doc = await prisma.driverDocument.findUnique({ where: { id } });
  if (!doc || doc.driverId !== driverId) throw new NotFoundError('Document not found');
  await prisma.driverDocument.delete({ where: { id } });
  // Best-effort file cleanup (local dev only)
  const filename = path.basename(doc.fileUrl);
  fs.promises.unlink(path.join(UPLOAD_DIR, filename)).catch(() => undefined);
}

export async function listDocumentsForVendor(driverId: string, vendorId?: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver) throw new NotFoundError('Driver not found');
  if (vendorId && driver.vendorId !== vendorId) throw new ForbiddenError('Access denied');
  return prisma.driverDocument.findMany({ where: { driverId }, orderBy: { createdAt: 'desc' } });
}

export async function setDocumentStatus(
  docId: string,
  status: 'pending' | 'verified' | 'rejected',
  reviewedBy: string,
  rejectionNote?: string,
  vendorId?: string,
) {
  const doc = await prisma.driverDocument.findUnique({ where: { id: docId }, include: { driver: true } });
  if (!doc) throw new NotFoundError('Document not found');
  if (vendorId && doc.driver.vendorId !== vendorId) throw new ForbiddenError('Access denied');

  // Review rules:
  //   pending  -> verified | rejected
  //   verified -> rejected (a problem found later)
  //   rejected -> nothing. A rejected file is final; the driver must upload a
  //               new document, which starts again as pending.
  if (doc.status === 'rejected') {
    throw new ValidationError('This document was rejected. The driver must upload a new one for review.');
  }
  if (status === doc.status) {
    throw new ValidationError(`This document is already ${status}.`);
  }
  if (status === 'pending') {
    throw new ValidationError('A reviewed document cannot be moved back to pending.');
  }

  // Only the driver's latest upload of each type can be reviewed — older
  // copies are history once a replacement has been uploaded.
  const newer = await prisma.driverDocument.count({
    where: { driverId: doc.driverId, type: doc.type, createdAt: { gt: doc.createdAt } },
  });
  if (newer > 0) {
    throw new ValidationError('A newer version of this document has been uploaded. Review that one instead.');
  }

  return prisma.driverDocument.update({
    where: { id: docId },
    data: {
      status,
      reviewedBy,
      reviewedAt: new Date(),
      rejectionNote: status === 'rejected' ? (rejectionNote ?? null) : null,
    },
  });
}

// Count pending documents per vendor — used for approval badge in vendor nav
export async function countPendingDocsForVendor(vendorId: string): Promise<number> {
  return prisma.driverDocument.count({
    where: {
      status: 'pending',
      driver: { vendorId },
    },
  });
}
