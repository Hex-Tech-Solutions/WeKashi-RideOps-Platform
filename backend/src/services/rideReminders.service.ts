/**
 * Pickup reminders for rides and rentals a driver has claimed / been given.
 *
 * A driver gets a push 24 hours, 2 hours and 45 minutes before the FIRST PICKUP
 * (45 min is when the ride becomes their active ride and can be started). For a
 * group ride that is the first stop's pickup time, NOT the login / shift time,
 * which can be hours later (see lib/rideTiming.ts). Each step is sent once per
 * driver + ride (driver_notice_log), and a step is skipped if the ride was
 * assigned after that step's moment — claiming a ride 90 minutes ahead does not
 * trigger a "24 hours" or "2 hours" reminder.
 *
 * Runs every 5 minutes, so a reminder lands within a few minutes of its time.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { notifyRideReminder } from './driverNotice.service';
import { firstPickupAt } from '../lib/rideTiming';

/** Minutes before pickup, largest first. */
export const REMINDER_MINUTES = [1440, 120, 45] as const;
const MS_MIN = 60 * 1000;

/**
 * The step to send now: the tightest step already reached (e.g. 100 minutes
 * left -> 120), or null if the pickup is more than 24 h away. Returns null too
 * when that step's moment was before the ride was assigned.
 */
export function reminderToSend(
  scheduledFor: Date,
  assignedAt: Date,
  now = new Date(),
): { step: number; minutesLeft: number } | null {
  const minutesLeft = (scheduledFor.getTime() - now.getTime()) / MS_MIN;
  if (minutesLeft <= 0) return null; // pickup time has passed
  const reached = [...REMINDER_MINUTES].filter((s) => minutesLeft <= s);
  if (reached.length === 0) return null;
  const step = Math.min(...reached);
  const stepMoment = scheduledFor.getTime() - step * MS_MIN;
  if (stepMoment < assignedAt.getTime()) return null; // assigned after this step was due
  return { step, minutesLeft };
}

interface Row {
  id: string;
  driver_id: string;
  scheduled_for: Date;
  pickup_address: string;
  assigned_at: Date;
  /** Rides only: 'login' | 'logout' | 'airport'. */
  type?: string | null;
  /** Rides only: "HH:MM" of the first stop's pickup (India time). */
  first_pickup?: string | null;
}

/** Pickups can be up to this long before the shift time (see rideTiming.ts). */
const MAX_PICKUP_BEFORE_SHIFT_MIN = 360;

async function claim(driverId: string, kind: string, ref: string): Promise<boolean> {
  try {
    await prisma.driverNoticeLog.create({ data: { driverId, kind, ref } });
    return true;
  } catch (e: any) {
    if (e?.code === 'P2002') return false; // already sent
    throw e;
  }
}

export async function runRideReminders(): Promise<{ sent: number }> {
  const horizonMin = REMINDER_MINUTES[0];
  // The first pickup can be hours BEFORE scheduled_for (the shift time), so look
  // that much further ahead and let reminderToSend() decide from the real pickup.
  const rideHorizonMin = horizonMin + MAX_PICKUP_BEFORE_SHIFT_MIN;
  const rides = await prisma.$queryRaw<Row[]>`
    SELECT r.id, r.driver_id, r.scheduled_for, r.pickup_address, r.type::text AS type,
           (SELECT p.scheduled_pickup_time FROM ride_pax p
             WHERE p.ride_id = r.id AND p.scheduled_pickup_time IS NOT NULL
             ORDER BY p.seq ASC LIMIT 1) AS first_pickup,
           COALESCE(r.claimed_at, r.accepted_at, r.created_at) AS assigned_at
    FROM rides r
    JOIN drivers d ON d.id = r.driver_id AND d.status = 'active'
    WHERE r.status = 'assigned'
      AND r.scheduled_for IS NOT NULL
      AND r.scheduled_for > NOW()
      AND r.scheduled_for <= NOW() + make_interval(mins => ${rideHorizonMin}::int)
  `;
  const rentals = await prisma.$queryRaw<Row[]>`
    SELECT r.id, r.driver_id, r.scheduled_for, r.pickup_address,
           COALESCE(r.accepted_at, r.created_at) AS assigned_at
    FROM rentals r
    JOIN drivers d ON d.id = r.driver_id AND d.status = 'active'
    WHERE r.status = 'assigned'
      AND r.scheduled_for IS NOT NULL
      AND r.scheduled_for > NOW()
      AND r.scheduled_for <= NOW() + make_interval(mins => ${horizonMin}::int)
  `;

  let sent = 0;
  const now = new Date();
  const handle = async (rows: Row[], kind: 'ride_reminder' | 'rental_reminder', isRental: boolean) => {
    for (const r of rows) {
      // Rentals: scheduled_for IS the pickup. Rides: count from the first stop.
      const pickupAt = isRental ? r.scheduled_for : firstPickupAt(r.scheduled_for, r.type, r.first_pickup);
      const due = reminderToSend(pickupAt, r.assigned_at, now);
      if (!due) continue;
      // driver id in the key: a ride released and re-claimed by someone else
      // must still remind the new driver.
      if (!(await claim(r.driver_id, kind, `${r.driver_id}:${r.id}:${due.step}`))) continue;
      await notifyRideReminder(
        r.driver_id,
        {
          pickupAddress: r.pickup_address,
          scheduledFor: pickupAt,
          // Shown as "Login ..." when it differs from the first pickup.
          loginAt: !isRental && pickupAt.getTime() !== r.scheduled_for.getTime() ? r.scheduled_for : null,
        },
        due.minutesLeft,
        isRental,
      );
      sent++;
    }
  };
  await handle(rides, 'ride_reminder', false);
  await handle(rentals, 'rental_reminder', true);
  if (sent > 0) logger.info({ sent }, 'Ride pickup reminders sent');
  return { sent };
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export function initRideReminderSweeper(): void {
  if (timer) clearInterval(timer);
  const run = () => runRideReminders().catch((err) => logger.error({ err }, 'Ride reminder sweep failed'));
  void run();
  timer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info('Ride reminder sweeper started (interval: 5m)');
}

export function stopRideReminderSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
