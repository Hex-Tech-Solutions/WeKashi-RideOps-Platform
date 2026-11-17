/**
 * Document expiry (#13).
 *
 * "Current copy" of a document type = the driver's newest REVIEWED upload of
 * that type (same rule as kyc.service). Only verified current copies with an
 * expiry date are tracked; a newer upload still waiting for review is a
 * "renewal pending".
 *
 *  - Reminders to the driver at 30, 15, 7 and 1 days before expiry, and once
 *    when it expires. Each step is sent at most once per document
 *    (doc_expiry_notices). If the driver already uploaded a renewal, the
 *    before-expiry reminders are skipped (the vendor sees it to review).
 *  - Vendors see the same list (expiring within 30 days + expired) in their
 *    console.
 *  - Rides: see lib/rideEligibility.ts (expired current copy = no rides).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sweepExpiredKyc } from '../lib/kycSweeper';
import { notifyDocumentExpiring, notifyDocumentExpired } from './driverNotice.service';

export const REMINDER_STEPS = [30, 15, 7, 1] as const;
export const EXPIRY_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until expiry, rounded up (negative or 0 = expired). */
export function daysUntil(expiry: Date, now = new Date()): number {
  return Math.ceil((expiry.getTime() - now.getTime()) / DAY_MS) || 0; // avoid -0
}

/**
 * The reminder step that applies now: 0 when expired, otherwise the tightest
 * step already reached (e.g. 10 days left -> 15), or null if more than 30 days.
 */
export function reminderStep(daysLeft: number): number | null {
  if (daysLeft <= 0) return 0;
  for (const s of [...REMINDER_STEPS].reverse()) if (daysLeft <= s) return s;
  return null;
}

export interface ExpiringDoc {
  documentId: string;
  driverId: string;
  type: string;
  expiry: Date;
  daysLeft: number;
  renewalPending: boolean;
}

interface Row {
  id: string; driver_id: string; type: string; expiry: Date; renewal_pending: boolean;
}

/**
 * Current verified copies expiring within EXPIRY_WINDOW_DAYS (or expired) for
 * active / pending drivers. Optional filters by driver or vendor.
 */
export async function listExpiringDocs(filter: { driverId?: string; vendorId?: string } = {}): Promise<ExpiringDoc[]> {
  const byDriver = filter.driverId ? Prisma.sql`AND d.id = ${filter.driverId}` : Prisma.empty;
  const byVendor = filter.vendorId ? Prisma.sql`AND d.vendor_id = ${filter.vendorId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT cur.id, cur.driver_id, cur.type, cur.expiry,
      EXISTS (
        SELECT 1 FROM driver_documents p
        WHERE p.driver_id = cur.driver_id AND p.type = cur.type
          AND p.status = 'pending' AND p.created_at > cur.created_at
      ) AS renewal_pending
    FROM (
      SELECT DISTINCT ON (doc.driver_id, doc.type)
        doc.id, doc.driver_id, doc.type, doc.status, doc.expiry, doc.created_at
      FROM driver_documents doc
      JOIN drivers d ON d.id = doc.driver_id
      WHERE doc.status <> 'pending'
        AND d.status IN ('active', 'pending')
        ${byDriver} ${byVendor}
      ORDER BY doc.driver_id, doc.type, doc.created_at DESC
    ) cur
    WHERE cur.status = 'verified'
      AND cur.expiry IS NOT NULL
      AND cur.expiry < NOW() + make_interval(days => ${EXPIRY_WINDOW_DAYS})
    ORDER BY cur.expiry ASC
  `;
  const now = new Date();
  return rows.map((r) => ({
    documentId: r.id,
    driverId: r.driver_id,
    type: r.type,
    expiry: r.expiry,
    daysLeft: daysUntil(r.expiry, now),
    renewalPending: r.renewal_pending,
  }));
}

/** Record a reminder step; false if it was already sent. */
async function claimNotice(doc: ExpiringDoc, threshold: number): Promise<boolean> {
  try {
    await prisma.docExpiryNotice.create({ data: { documentId: doc.documentId, driverId: doc.driverId, threshold } });
    return true;
  } catch (e: any) {
    if (e?.code === 'P2002') return false;
    throw e;
  }
}

/** One pass: send due reminders, then flip expired drivers' KYC. */
export async function runExpiryReminders(): Promise<{ sent: number }> {
  let sent = 0;
  const docs = await listExpiringDocs();
  for (const doc of docs) {
    const step = reminderStep(doc.daysLeft);
    if (step === null) continue;
    // Renewal already uploaded: no "expires soon" nag. Still tell them once it
    // has expired, because rides stop until the renewal is verified.
    if (step > 0 && doc.renewalPending) continue;
    if (!(await claimNotice(doc, step))) continue;
    if (step === 0) await notifyDocumentExpired(doc.driverId, doc.type);
    else await notifyDocumentExpiring(doc.driverId, doc.type, doc.daysLeft);
    sent++;
  }
  await sweepExpiredKyc();
  if (sent > 0) logger.info({ sent }, 'Document expiry reminders sent');
  return { sent };
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly; each step is sent once
let timer: NodeJS.Timeout | null = null;

export function initDocExpirySweeper(): void {
  if (timer) clearInterval(timer);
  const run = () => runExpiryReminders().catch((err) => logger.error({ err }, 'Document expiry sweep failed'));
  void run();
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info('Document expiry sweeper started (interval: 1h)');
}

export function stopDocExpirySweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
