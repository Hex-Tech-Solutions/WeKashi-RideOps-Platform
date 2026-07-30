import { prisma } from './prisma';
import { logger } from './logger';

// ─── KYC Expiry Sweeper ───────────────────────────────────────────────────────
//
// Runs every 6 hours. Finds drivers whose kycStatus is 'approved' but have at
// least one *verified* document whose expiry date has now passed. Sets their
// kycStatus to 'expired' so they are excluded from ride broadcasts until they
// re-upload and a vendor/admin re-verifies the document.

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let sweeperInterval: NodeJS.Timeout | null = null;

export function initKycSweeper(): void {
  if (sweeperInterval) clearInterval(sweeperInterval);

  // Run once immediately on startup, then on the interval.
  sweepExpiredKyc().catch((err) => logger.error({ err }, 'KYC sweeper startup run failed'));

  sweeperInterval = setInterval(() => {
    sweepExpiredKyc().catch((err) => logger.error({ err }, 'KYC sweeper interval run failed'));
  }, SWEEP_INTERVAL_MS);

  logger.info('KYC expiry sweeper started (interval: 6h)');
}

export function stopKycSweeper(): void {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
    logger.info('KYC expiry sweeper stopped');
  }
}

/**
 * Mark drivers as KYC-expired when any of their verified documents has an
 * expiry date in the past.
 *
 * Only drivers currently kycStatus = 'approved' are affected — drivers already
 * 'rejected' or 'pending' are left unchanged.
 */
export async function sweepExpiredKyc(): Promise<void> {
  try {
    // Find all drivers with at least one verified-but-expired document.
    const expiredDriverIds = await prisma.$queryRaw<Array<{ driver_id: string }>>`
      SELECT DISTINCT driver_id
      FROM driver_documents
      WHERE status  = 'verified'
        AND expiry IS NOT NULL
        AND expiry  < NOW()
    `;

    if (expiredDriverIds.length === 0) return;

    const ids = expiredDriverIds.map((r) => r.driver_id);

    // Only flip drivers whose kycStatus is currently 'approved'.
    const result = await prisma.driver.updateMany({
      where: {
        id: { in: ids },
        kycStatus: 'approved',
      },
      data: { kycStatus: 'expired' },
    });

    if (result.count > 0) {
      logger.info({ count: result.count, driverIds: ids }, 'KYC sweeper: marked drivers as KYC expired');
    }
  } catch (err) {
    logger.error({ err }, 'sweepExpiredKyc error');
  }
}
