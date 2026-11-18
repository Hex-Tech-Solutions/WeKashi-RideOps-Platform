/**
 * Pack-expiry reminders. A pack that still has unused credits and expires
 * within 30 days gets a push at 30, 7 and 1 days before expiry, each sent once
 * (driver_notice_log). Only active accounts are notified.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { notifyPackExpiring } from './driverNotice.service';

export const PACK_REMINDER_STEPS = [30, 7, 1] as const;
const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days until expiry, rounded up. */
export function packDaysLeft(expiresAt: Date, now = new Date()): number {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS) || 0;
}

/** The reminder step that applies for `daysLeft` (1, 7 or 30), or null beyond 30 days / already expired. */
export function packReminderStep(daysLeft: number): 1 | 7 | 30 | null {
  if (daysLeft <= 0) return null;
  if (daysLeft <= 1) return 1;
  if (daysLeft <= 7) return 7;
  if (daysLeft <= WINDOW_DAYS) return 30;
  return null;
}

interface Row { id: string; driver_id: string; credits_remaining: number; expires_at: Date }

export async function runPackExpiryReminders(): Promise<{ sent: number }> {
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c.driver_id, c.credits_remaining, c.expires_at
    FROM credit_packs c
    JOIN drivers d ON d.id = c.driver_id AND d.status = 'active'
    WHERE c.status = 'active'
      AND c.credits_remaining > 0
      AND c.expires_at > NOW()
      AND c.expires_at < NOW() + make_interval(days => ${WINDOW_DAYS}::int)
    ORDER BY c.expires_at ASC
  `;
  let sent = 0;
  const now = new Date();
  for (const r of rows) {
    const daysLeft = packDaysLeft(r.expires_at, now);
    const step = packReminderStep(daysLeft);
    if (step === null) continue;
    try {
      await prisma.driverNoticeLog.create({
        data: { driverId: r.driver_id, kind: 'pack_expiring', ref: `${r.id}:${step}` },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') continue; // this step was already sent
      throw e;
    }
    const expiresOn = r.expires_at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    await notifyPackExpiring(r.driver_id, Number(r.credits_remaining), daysLeft, expiresOn);
    sent++;
  }
  if (sent > 0) logger.info({ sent }, 'Pack-expiry reminders sent');
  return { sent };
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly; each step is sent once
let timer: NodeJS.Timeout | null = null;

export function initPackExpirySweeper(): void {
  if (timer) clearInterval(timer);
  const run = () => runPackExpiryReminders().catch((err) => logger.error({ err }, 'Pack-expiry sweep failed'));
  void run();
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info('Pack-expiry sweeper started (interval: 1h)');
}

export function stopPackExpirySweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
