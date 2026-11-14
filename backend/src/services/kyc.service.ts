/**
 * Driver KYC status, derived from the driver's documents (#1).
 *
 * For each required document type, the NEWEST REVIEWED upload decides:
 *   - verified and not expired -> the type is OK
 *   - verified but expired     -> the type is expired
 *   - rejected                 -> the type is rejected (driver must upload again)
 *   - no reviewed upload yet   -> the type is pending
 * Pending uploads never change the result, so a driver renewing a document
 * keeps working on the current verified copy until the new one is reviewed.
 *
 * Overall: any rejected -> 'rejected', else any expired -> 'expired',
 * else any pending -> 'pending', else 'approved'.
 *
 * Credits: the ONLY credit effect of KYC is the one-time joining bonus, granted
 * when KYC is approved (grantBonusIfKycApproved). It is guarded once per
 * account and once per person, so renewals and re-verification never add
 * credits.
 */
import type { KycStatus, Prisma } from '@prisma/client';
import { logger } from '../lib/logger';
import { REQUIRED_DOC_TYPES } from '../lib/documentTypes';

export interface KycDoc {
  type: string;
  status: string;          // 'pending' | 'verified' | 'rejected'
  expiry: Date | null;
  createdAt: Date;
}

/** Pure rule, see the file header. Exported for unit tests. */
export function computeKycStatus(docs: KycDoc[], now = new Date()): KycStatus {
  // Newest reviewed upload per type.
  const decisive = new Map<string, KycDoc>();
  for (const d of docs) {
    if (d.status === 'pending') continue;
    const cur = decisive.get(d.type);
    if (!cur || d.createdAt > cur.createdAt) decisive.set(d.type, d);
  }

  let anyRejected = false;
  let anyExpired = false;
  let anyPending = false;
  for (const type of REQUIRED_DOC_TYPES) {
    const d = decisive.get(type);
    if (!d) anyPending = true;
    else if (d.status === 'rejected') anyRejected = true;
    else if (d.expiry && d.expiry.getTime() < now.getTime()) anyExpired = true;
  }

  if (anyRejected) return 'rejected';
  if (anyExpired) return 'expired';
  if (anyPending) return 'pending';
  return 'approved';
}

/**
 * Recompute and store the driver's KYC status. Call inside the transaction
 * that changed a document's review status. Locks the driver row so two
 * reviews at once can't write a stale result.
 */
export async function recomputeKycStatus(
  driverId: string,
  tx: Prisma.TransactionClient,
): Promise<{ from: KycStatus; to: KycStatus }> {
  await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${driverId} FOR UPDATE`;
  const [driver, docs] = await Promise.all([
    tx.driver.findUnique({ where: { id: driverId }, select: { kycStatus: true } }),
    tx.driverDocument.findMany({
      where: { driverId },
      select: { type: true, status: true, expiry: true, createdAt: true },
    }),
  ]);
  if (!driver) return { from: 'pending', to: 'pending' };

  const next = computeKycStatus(docs);
  if (next !== driver.kycStatus) {
    await tx.driver.update({ where: { id: driverId }, data: { kycStatus: next } });
    logger.info({ driverId, from: driver.kycStatus, to: next }, 'Driver KYC status changed');
  }
  return { from: driver.kycStatus, to: next };
}

/**
 * After a review is committed: if KYC is now approved, try the joining bonus.
 * grantJoiningBonus is once per account AND once per person, so later
 * approvals (renewals, re-verification) never add credits again.
 */
export async function grantBonusIfKycApproved(driverId: string, result: { to: KycStatus }): Promise<void> {
  if (result.to !== 'approved') return;
  const { grantJoiningBonus } = await import('./creditPack.service');
  await grantJoiningBonus(driverId);
}
