import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { UPLOAD_DIR } from '../lib/storage';
import { NotFoundError, ForbiddenError } from '../types';

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
  // Best-effort file cleanup
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
  vendorId?: string,
) {
  const doc = await prisma.driverDocument.findUnique({ where: { id: docId }, include: { driver: true } });
  if (!doc) throw new NotFoundError('Document not found');
  if (vendorId && doc.driver.vendorId !== vendorId) throw new ForbiddenError('Access denied');
  return prisma.driverDocument.update({ where: { id: docId }, data: { status } });
}
