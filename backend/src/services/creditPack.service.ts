// Credit_Ledger — the driver's ride-credit balance, tracked as a stack of
// independent packs (purchased or joining-bonus). Credits gate broadcast
// eligibility and are consumed one-per-completed-ride, oldest-expiring first.
//
// Invariants:
//   - availableCredits = Σ creditsRemaining over packs that are active AND
//     not past expiry.
//   - consumeOneCredit burns exactly one credit per completed ride, never on
//     cancel/no-show, and never twice for the same ride (Ride.creditConsumed).
//   - grantJoiningBonus runs at most once per driver (joiningBonusGrantedAt)
//     and at most once per person (identity match against earlier bonus
//     accounts, including deleted ones).
//   - activatePurchasedPack is idempotent via the caller's PackOrder guard.

import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { PACK_CATALOG, PackKey, JOINING_BONUS_CREDITS, packExpiry } from '../lib/creditPacks';
import { logger } from '../lib/logger';

export interface PackView {
  id: string;
  source: string;
  creditsRemaining: number;
  creditsTotal: number;
  expiresAt: Date;
  status: string;
}

/**
 * Total credits a driver can currently use: sum of creditsRemaining over packs
 * that are active, still have credits, and have not passed their expiry.
 * (Req 8.3 / 9.3 — expired and exhausted packs contribute zero.)
 */
export async function availableCredits(driverId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT COALESCE(SUM(credits_remaining), 0) AS total
    FROM credit_packs
    WHERE driver_id = ${driverId}
      AND status = 'active'
      AND credits_remaining > 0
      AND expires_at > NOW()
  `;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Credits a driver can still commit to a NEW ride.
 *
 * Normal / scheduled / airport rides only burn their credit on completion, so
 * every ride the driver has accepted or claimed but not finished is already
 * "spoken for". Without subtracting those, one credit could back several
 * accepted rides. Rentals burn on accept, so they are already reflected in
 * availableCredits and are not counted again here.
 *
 * Pass a transaction client to read inside the caller's transaction.
 */
export async function spareCredits(
  driverId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ available: bigint | number | null; reserved: bigint | number | null }>>`
    SELECT
      (SELECT COALESCE(SUM(credits_remaining), 0) FROM credit_packs
        WHERE driver_id = ${driverId} AND status = 'active'
          AND credits_remaining > 0 AND expires_at > NOW()) AS available,
      (SELECT COUNT(*) FROM rides
        WHERE driver_id = ${driverId}
          AND status IN ('assigned', 'in_progress')
          AND credit_consumed = false) AS reserved
  `;
  const available = Number(rows[0]?.available ?? 0);
  const reserved = Number(rows[0]?.reserved ?? 0);
  return Math.max(0, available - reserved);
}

/**
 * List a driver's packs for display, lazily flipping any past-expiry packs to
 * 'expired' first so the returned view is accurate. (Req 8.3, 9.1)
 */
export async function listPacks(driverId: string): Promise<PackView[]> {
  await expireStalePacks(driverId);
  const packs = await prisma.creditPack.findMany({
    where: { driverId },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
  });
  return packs.map((p) => ({
    id: p.id,
    source: p.source,
    creditsRemaining: p.creditsRemaining,
    creditsTotal: p.creditsTotal,
    expiresAt: p.expiresAt,
    status: p.status,
  }));
}

/** Opportunistically mark past-expiry active packs as expired. */
async function expireStalePacks(driverId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE credit_packs
    SET status = 'expired'
    WHERE driver_id = ${driverId}
      AND status = 'active'
      AND expires_at <= NOW()
  `;
}

/**
 * Has the same PERSON already received a joining bonus on another account?
 * Matches this driver's identity keys against every other account that was
 * granted a bonus, including removed (deleted) and rejected ones, so deleting
 * an account and joining again (e.g. with another vendor) doesn't earn a
 * second bonus. Keys: phone / alt phone (last 10 digits, either column),
 * DL number, Aadhaar hash, UPI ID, vehicle reg no (linked vehicle or RC doc).
 * Renamed values on removed/rejected rows ("removed:<id8>:...") still match.
 */
async function findPriorBonusAccount(
  driverId: string,
  db: Prisma.TransactionClient,
): Promise<{ id: string; field: string } | null> {
  const rows = await db.$queryRaw<Array<{ id: string; field: string }>>`
    WITH me AS (
      SELECT
        d.id,
        NULLIF(right(regexp_replace(d.phone, '\\D', '', 'g'), 10), '')                        AS p1,
        NULLIF(right(regexp_replace(coalesce(d.alt_phone, ''), '\\D', '', 'g'), 10), '')      AS p2,
        NULLIF(upper(regexp_replace(coalesce(d.dl_number, ''), '[^A-Za-z0-9]', '', 'g')), '') AS dl,
        NULLIF(d.gov_id_hash, '')                                                             AS gid,
        NULLIF(lower(coalesce(d.upi_vpa, '')), '')                                            AS upi,
        NULLIF(upper(regexp_replace(
          regexp_replace(coalesce(v.reg_no, ''), '^(removed|rejected):[^:]*:', ''),
          '[^A-Za-z0-9]', '', 'g')), '')                                                     AS reg
      FROM drivers d
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.id = ${driverId}
    ),
    other AS (
      SELECT
        o.id,
        NULLIF(right(regexp_replace(o.phone, '\\D', '', 'g'), 10), '')                        AS p1,
        NULLIF(right(regexp_replace(coalesce(o.alt_phone, ''), '\\D', '', 'g'), 10), '')      AS p2,
        NULLIF(upper(regexp_replace(coalesce(o.dl_number, ''), '[^A-Za-z0-9]', '', 'g')), '') AS dl,
        NULLIF(o.gov_id_hash, '')                                                             AS gid,
        NULLIF(lower(coalesce(o.upi_vpa, '')), '')                                            AS upi,
        NULLIF(upper(regexp_replace(
          regexp_replace(coalesce(ov.reg_no, ''), '^(removed|rejected):[^:]*:', ''),
          '[^A-Za-z0-9]', '', 'g')), '')                                                     AS reg,
        o.created_at
      FROM drivers o
      LEFT JOIN vehicles ov ON ov.id = o.vehicle_id
      WHERE o.id <> ${driverId} AND o.joining_bonus_granted_at IS NOT NULL
    )
    SELECT o.id,
      CASE
        WHEN me.p1 IN (o.p1, o.p2) OR me.p2 IN (o.p1, o.p2) THEN 'phone'
        WHEN me.dl  = o.dl  THEN 'dlNumber'
        WHEN me.gid = o.gid THEN 'aadhaar'
        WHEN me.upi = o.upi THEN 'upiVpa'
        ELSE 'regNo'
      END AS field
    FROM other o, me
    WHERE me.p1 IN (o.p1, o.p2)
       OR me.p2 IN (o.p1, o.p2)
       OR me.dl  = o.dl
       OR me.gid = o.gid
       OR me.upi = o.upi
       OR me.reg = o.reg
       OR (me.reg IS NOT NULL AND EXISTS (
            SELECT 1 FROM driver_documents doc
            WHERE doc.driver_id = o.id AND doc.type = 'rc'
              AND upper(regexp_replace(coalesce(doc.number, ''), '[^A-Za-z0-9]', '', 'g')) = me.reg))
    ORDER BY o.created_at
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Grant the one-time joining-bonus credit. Once per PERSON, not just per
 * account:
 *  - Driver.joiningBonusGrantedAt makes it once per account (atomic claim).
 *  - findPriorBonusAccount stops a second bonus when the same person already
 *    got one on another account (deleted and re-joined, etc.). The match is
 *    logged and flagged to admins (/admin/duplicates); nothing is granted.
 * (Req 7.1, 7.3)
 */
export async function grantJoiningBonus(driverId: string): Promise<void> {
  const check: { repeatOf: { id: string; field: string } | null } = { repeatOf: null };
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    // Serialise grants for this driver, then check for an earlier bonus.
    await tx.$queryRaw`SELECT id FROM drivers WHERE id = ${driverId} FOR UPDATE`;
    const fresh = await tx.driver.findUnique({ where: { id: driverId }, select: { joiningBonusGrantedAt: true } });
    if (!fresh || fresh.joiningBonusGrantedAt) return;
    check.repeatOf = await findPriorBonusAccount(driverId, tx);
    if (check.repeatOf) return; // same person already had a bonus — grant nothing

    // Claim the grant atomically: only the one call that flips
    // joiningBonusGrantedAt from NULL proceeds. Re-activation, KYC renewal,
    // document re-verification or concurrent calls can never grant twice.
    const claimed = await tx.driver.updateMany({
      where: { id: driverId, joiningBonusGrantedAt: null },
      data: { joiningBonusGrantedAt: now },
    });
    if (claimed.count === 0) return;

    await tx.creditPack.create({
      data: {
        driverId,
        source: 'joining_bonus',
        creditsTotal: JOINING_BONUS_CREDITS,
        creditsRemaining: JOINING_BONUS_CREDITS,
        pricePaid: 0,
        activatedAt: now,
        expiresAt: packExpiry(now),
        status: 'active',
      },
    });
  });

  if (check.repeatOf) {
    const prior = check.repeatOf;
    logger.warn(
      { driverId, priorDriverId: prior.id, field: prior.field },
      'Joining bonus withheld: same person already received one on another account',
    );
    const { flagPossibleDuplicate } = await import('../lib/identity');
    await flagPossibleDuplicate({
      kind: 'repeat_joining_bonus',
      driverId,
      otherDriverId: prior.id,
      detail: `Joining bonus not granted — matched on ${prior.field}`,
    });
  }
}

/**
 * Activate a purchased pack: create the CreditPack bucket with full credits and
 * a 365-day expiry. Called from packOrder.service inside its idempotent guard.
 * (Req 6.2, 6.3, 8.1)
 */
export async function activatePurchasedPack(
  tx: Prisma.TransactionClient,
  driverId: string,
  packKey: PackKey,
  packOrderId: string,
): Promise<{ id: string }> {
  const def = PACK_CATALOG[packKey];
  const now = new Date();
  const pack = await tx.creditPack.create({
    data: {
      driverId,
      source: 'purchase',
      creditsTotal: def.credits,
      creditsRemaining: def.credits,
      pricePaid: def.price,
      packOrderId,
      activatedAt: now,
      expiresAt: packExpiry(now),
      status: 'active',
    },
    select: { id: true },
  });
  return pack;
}

/**
 * Consume exactly one credit for a completed ride, oldest-expiring pack first,
 * idempotent per ride. If the driver has no available credit the ride still
 * completes (Req 11.4) but nothing is burned. (Req 10.1, 10.2, 10.5)
 *
 * Runs inside the caller-provided transaction so it commits atomically with the
 * ride's completion.
 */
export async function consumeOneCredit(
  tx: Prisma.TransactionClient,
  driverId: string,
  rideId: string,
): Promise<void> {
  // Idempotency: lock the ride row and bail if a credit was already burned.
  const rideRows = await tx.$queryRaw<Array<{ credit_consumed: boolean }>>`
    SELECT credit_consumed FROM rides WHERE id = ${rideId} FOR UPDATE
  `;
  if (rideRows.length === 0 || rideRows[0].credit_consumed) return;

  // Oldest-expiring active pack with credits left; stable tiebreak on created_at.
  const packRows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM credit_packs
    WHERE driver_id = ${driverId}
      AND status = 'active'
      AND credits_remaining > 0
      AND expires_at > NOW()
    ORDER BY expires_at ASC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;

  if (packRows.length === 0) {
    // No credit available — complete the ride, burn nothing.
    logger.info({ driverId, rideId }, 'Ride completed with no available credit — none burned');
    return;
  }

  const packId = packRows[0].id;
  await tx.$executeRaw`
    UPDATE credit_packs
    SET credits_remaining = credits_remaining - 1,
        status = CASE WHEN credits_remaining - 1 <= 0 THEN 'exhausted' ELSE status END
    WHERE id = ${packId}
  `;
  await tx.$executeRaw`
    UPDATE rides SET credit_consumed = true WHERE id = ${rideId}
  `;
}

/**
 * Driver earnings dashboard (shown on the empty broadcasts screen):
 *   - totalEarnings  Σ (price + escortCharge) over the driver's COMPLETED rides
 *   - trips          count of COMPLETED rides
 *   - creditsLeft    current usable credit balance
 *   - totalExpenses  Σ amount over PAID pack orders (subscription purchases)
 *   - profit         totalEarnings − totalExpenses
 */
export async function getDriverStats(driverId: string): Promise<{
  totalEarnings: number;
  trips: number;
  creditsLeft: number;
  totalExpenses: number;
  profit: number;
}> {
  const [rides, paidOrders, creditsLeft] = await Promise.all([
    prisma.ride.findMany({
      where: { driverId, status: 'completed' },
      select: { price: true, escortCharge: true },
    }),
    prisma.packOrder.findMany({
      where: { driverId, status: 'paid' },
      select: { amount: true },
    }),
    availableCredits(driverId),
  ]);

  const totalEarnings = rides.reduce(
    (sum, r) => sum + (r.price ?? 0) + (r.escortCharge ?? 0),
    0,
  );
  const totalExpenses = paidOrders.reduce((sum, o) => sum + (o.amount ?? 0), 0);

  return {
    totalEarnings: Math.round(totalEarnings),
    trips: rides.length,
    creditsLeft,
    totalExpenses: Math.round(totalExpenses),
    profit: Math.round(totalEarnings - totalExpenses),
  };
}
