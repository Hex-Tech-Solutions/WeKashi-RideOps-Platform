/**
 * Who may take rides (#13).
 *
 * A driver gets / accepts / claims / is assigned rides only when:
 *   - the account is active,
 *   - KYC is approved, and
 *   - no CURRENT copy of a document (newest reviewed upload of its type) is
 *     verified-but-expired. Checked directly, so the gap until the KYC sweeper
 *     marks the driver 'expired' can't be used to take rides.
 *   - (Phase 2) for the driver's own accept/claim: a valid face check
 *     (services/faceCheck.service.ts).
 */
import { Prisma } from '@prisma/client';
import { ForbiddenError } from '../types';
import { DOC_TYPE_RULES } from './documentTypes';
import { assertFaceCheckValid } from '../services/faceCheck.service';

/**
 * SQL condition "this driver has no expired current document". `driverIdCol`
 * is the column holding the driver id in the outer query, e.g. 'd.id' or
 * 'drivers.id'. Only fixed identifiers are passed in (never user input).
 */
export function noExpiredDocSql(driverIdCol: 'd.id' | 'drivers.id' | 'id'): Prisma.Sql {
  const col = Prisma.raw(driverIdCol);
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM (
      SELECT DISTINCT ON (xd.type) xd.status, xd.expiry
      FROM driver_documents xd
      WHERE xd.driver_id = ${col} AND xd.status <> 'pending'
      ORDER BY xd.type, xd.created_at DESC
    ) xcur
    WHERE xcur.status = 'verified' AND xcur.expiry IS NOT NULL AND xcur.expiry < NOW()
  )`;
}

/**
 * Throw a clear 403 if the driver can't take rides right now. `subject` picks
 * the wording: 'self' for the driver app, 'other' for a supervisor/vendor
 * assigning someone.
 */
export async function assertDriverCanTakeRides(
  driverId: string,
  db: Prisma.TransactionClient,
  subject: 'self' | 'other' = 'self',
): Promise<void> {
  const d = await db.driver.findUnique({ where: { id: driverId }, select: { status: true, kycStatus: true } });
  const you = subject === 'self';
  if (!d || d.status !== 'active') {
    throw new ForbiddenError(you ? 'Your account is not active' : 'This driver account is not active');
  }
  const expired = await db.$queryRaw<Array<{ type: string }>>`
    SELECT cur.type FROM (
      SELECT DISTINCT ON (type) type, status, expiry
      FROM driver_documents
      WHERE driver_id = ${driverId} AND status <> 'pending'
      ORDER BY type, created_at DESC
    ) cur
    WHERE cur.status = 'verified' AND cur.expiry IS NOT NULL AND cur.expiry < NOW()
  `;
  if (expired.length > 0) {
    const names = expired.map((e) => DOC_TYPE_RULES[e.type]?.label ?? e.type).join(', ');
    throw new ForbiddenError(
      you
        ? `Your ${names} expired. Upload a valid copy in Documents — no rides until it's verified.`
        : `This driver's ${names} expired. They can't take rides until a valid copy is verified.`,
    );
  }
  if (d.kycStatus !== 'approved') {
    throw new ForbiddenError(
      you
        ? 'Your KYC is not approved yet. Rides unlock once your vendor verifies your documents.'
        : "This driver's KYC is not approved, so they can't take rides.",
    );
  }
  // Phase 2 face check: the driver's own accept/claim needs a valid check. A
  // supervisor may still assign ('other'); the driver can't START it without one.
  if (you) await assertFaceCheckValid(driverId, db);
}
