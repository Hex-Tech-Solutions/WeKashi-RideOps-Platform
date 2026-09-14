// Credit_Ledger — the driver's ride-credit balance, tracked as a stack of
// independent packs (purchased or joining-bonus). Credits gate broadcast
// eligibility and are consumed one-per-completed-ride, oldest-expiring first.
//
// Invariants:
//   - availableCredits = Σ creditsRemaining over packs that are active AND
//     not past expiry.
//   - consumeOneCredit burns exactly one credit per completed ride, never on
//     cancel/no-show, and never twice for the same ride (Ride.creditConsumed).
//   - grantJoiningBonus runs at most once per driver (joiningBonusGrantedAt).
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
 * Grant the one-time joining-bonus credit. Guarded by Driver.joiningBonusGrantedAt
 * so it can never grant twice. (Req 7.1, 7.3)
 */
export async function grantJoiningBonus(driverId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      select: { joiningBonusGrantedAt: true },
    });
    if (!driver || driver.joiningBonusGrantedAt) return;

    const now = new Date();
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
    await tx.driver.update({
      where: { id: driverId },
      data: { joiningBonusGrantedAt: now },
    });
  });
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
