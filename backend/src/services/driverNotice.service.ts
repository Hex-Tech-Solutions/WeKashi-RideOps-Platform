/**
 * Account notices pushed to a driver's phone (not ride alerts).
 * Best-effort: never throws into the caller. With the app open, the in-app
 * banners (driver /me -> kycStatus) show the same thing.
 *
 * Every notice goes out on the quiet 'account_updates' channel and carries a
 * `screen` so tapping it opens the right place in the app.
 *
 * NOTE: a driver who has never signed in on a device has no push token, so
 * nothing here can reach someone who has only signed up and is waiting for
 * approval.
 */
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { isFcmEnabled, sendDriverNoticePush, type NoticeScreen } from '../lib/fcm';
import { DOC_TYPE_RULES } from '../lib/documentTypes';

interface Notice { title: string; body: string; kind: string; screen?: NoticeScreen }

/** Send to the driver's stored token, or to `token` when the account is about to lose it (removal). */
async function pushNotice(driverId: string, notice: Notice, token?: string | null): Promise<void> {
  if (!isFcmEnabled()) return;
  let target = token ?? null;
  if (!target) {
    const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { fcmToken: true } });
    target = d?.fcmToken ?? null;
  }
  if (!target) return;
  // NOTICE_TEST_PREFIX (e.g. "[TEST] ") is set only by scripts/sendTestNotices
  // so test pushes are clearly labelled. Empty in normal operation.
  const prefix = process.env.NOTICE_TEST_PREFIX ?? '';
  const { stale } = await sendDriverNoticePush(target, prefix ? { ...notice, title: `${prefix}${notice.title}` } : notice);
  if (stale) {
    // App uninstalled / data cleared — same handling as ride pushes.
    await prisma.driver.updateMany({ where: { id: driverId, fcmToken: target }, data: { fcmToken: null, isOnline: false } });
  }
}

/** Run a notice without ever throwing into the caller's flow. */
async function safely(driverId: string, kind: string, send: () => Promise<void>): Promise<void> {
  try {
    await send();
  } catch (err) {
    logger.error({ err, driverId, kind }, 'Driver notice failed');
  }
}

/** #13: a verified document expires in `daysLeft` days (30 / 15 / 7 / 1). */
export async function notifyDocumentExpiring(driverId: string, docType: string, daysLeft: number): Promise<void> {
  const label = DOC_TYPE_RULES[docType]?.label ?? 'document';
  const when = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`;
  await safely(driverId, 'document_expiring', () => pushNotice(driverId, {
    kind: 'document_expiring',
    screen: 'documents',
    title: `${label} expires ${when}`,
    body: `Upload your renewed ${label} in the Documents tab before it expires, or you won't get rides.`,
  }));
}

/** #13: a verified document has expired — rides are blocked until a new copy is verified. */
export async function notifyDocumentExpired(driverId: string, docType: string): Promise<void> {
  const label = DOC_TYPE_RULES[docType]?.label ?? 'document';
  await safely(driverId, 'document_expired', () => pushNotice(driverId, {
    kind: 'document_expired',
    screen: 'documents',
    title: `${label} expired — rides blocked`,
    body: `Your ${label} has expired. Upload a valid copy in the Documents tab. You won't get rides until it's verified.`,
  }));
}

/** Vendor/admin rejected a document: KYC is now rejected until a new copy is verified. */
export async function notifyDocumentRejected(driverId: string, docType: string, note?: string | null): Promise<void> {
  const label = DOC_TYPE_RULES[docType]?.label ?? 'document';
  const reason = note?.trim() ? ` Reason: ${note.trim().slice(0, 120)}.` : '';
  await safely(driverId, 'document_rejected', () => pushNotice(driverId, {
    kind: 'document_rejected',
    screen: 'documents',
    title: `${label} rejected — update needed`,
    body: `Your ${label} was rejected by your vendor.${reason} Upload a new one in the Documents tab. You won't get rides until it's verified.`,
  }));
}

/**
 * KYC just became approved. `bonusCredits` > 0 when the joining bonus was
 * added at the same moment. Only sent to an active account — a pending
 * account can't take rides yet, so "you can now take rides" would be wrong.
 */
export async function notifyKycApproved(driverId: string, bonusCredits: number): Promise<void> {
  await safely(driverId, 'kyc_approved', async () => {
    const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { status: true } });
    if (d?.status !== 'active') return;
    await pushNotice(driverId, {
      kind: 'kyc_approved',
      screen: bonusCredits > 0 ? 'credits' : 'home',
      title: 'KYC approved — you can take rides',
      body: bonusCredits > 0
        ? `All your documents are verified. ${bonusCredits} free ride credits have been added to your account.`
        : 'All your documents are verified. Go online to start receiving rides.',
    });
  });
}

/** Vendor/admin blacklisted or expired the account. */
export async function notifyAccountSuspended(driverId: string): Promise<void> {
  await safely(driverId, 'account_suspended', () => pushNotice(driverId, {
    kind: 'account_suspended',
    screen: 'home',
    title: 'Your account has been suspended',
    body: "You won't receive rides and can't sign in until your vendor reactivates it. Please contact your vendor.",
  }));
}

/** A suspended account was made active again. */
export async function notifyAccountReactivated(driverId: string): Promise<void> {
  await safely(driverId, 'account_reactivated', () => pushNotice(driverId, {
    kind: 'account_reactivated',
    screen: 'home',
    title: 'Your account is active again',
    body: 'Your vendor has reactivated your account. Sign in and go online to receive rides.',
  }));
}

/**
 * Vendor/admin deleted the account. The push token is cleared by the deletion
 * itself, so the caller passes the token it read BEFORE deleting.
 */
export async function notifyAccountRemoved(driverId: string, token: string | null): Promise<void> {
  if (!token) return;
  await safely(driverId, 'account_removed', () => pushNotice(driverId, {
    kind: 'account_removed',
    title: 'Your account was removed',
    body: 'Your vendor has removed your Wekashi account. If this is a mistake, please contact your vendor.',
  }, token));
}

/** Ride credits are running low (`remaining` = 2) or have run out (0). */
export async function notifyCreditsLow(driverId: string, remaining: number): Promise<void> {
  await safely(driverId, 'credits_low', () => pushNotice(driverId, {
    kind: 'credits_low',
    screen: 'credits',
    title: remaining <= 0 ? 'No ride credits left' : `Only ${remaining} ride credits left`,
    body: remaining <= 0
      ? "You won't receive new rides until you buy a pack. Tap to buy credits."
      : 'Buy a pack now so you keep receiving rides without a break.',
  }));
}

/** A pack with unused credits expires in `daysLeft` days (30 / 7 / 1). */
export async function notifyPackExpiring(driverId: string, credits: number, daysLeft: number, expiresOn: string): Promise<void> {
  const when = daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days (${expiresOn})`;
  await safely(driverId, 'pack_expiring', () => pushNotice(driverId, {
    kind: 'pack_expiring',
    screen: 'credits',
    title: `${credits} ride credits expire ${daysLeft <= 1 ? 'tomorrow' : `in ${daysLeft} days`}`,
    body: `Your unused credits expire ${when}. Use them or top up with a new pack. Unused credits are lost after that.`,
  }));
}

// ─── Ride, rental, payment and chat notices ──────────────────────────────────

/** "Fri 20 Nov, 10:30 am" in IST. */
export function formatIst(d: Date): string {
  return d.toLocaleString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'Asia/Kolkata',
  });
}

const short = (s: string | null | undefined, n = 60) => {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** A scheduled ride becomes the driver's ACTIVE ride this long before pickup. */
const ACTIVE_WINDOW_MS = 45 * 60 * 1000;

/** A supervisor or admin assigned a ride to this driver directly. */
export async function notifyRideAssigned(
  driverId: string,
  ride: { pickupAddress: string; dropAddress: string; scheduledFor: Date | null },
  queued: boolean,
): Promise<void> {
  const later = !!ride.scheduledFor && ride.scheduledFor.getTime() - Date.now() > ACTIVE_WINDOW_MS;
  await safely(driverId, 'ride_assigned', () => pushNotice(driverId, {
    kind: 'ride_assigned',
    screen: later ? 'scheduled' : 'home',
    title: queued ? 'A ride was queued as your next ride' : 'A ride was assigned to you',
    body: `${short(ride.pickupAddress)} → ${short(ride.dropAddress)}.`
      + (ride.scheduledFor ? ` Pickup ${formatIst(ride.scheduledFor)}.` : '')
      + (queued ? ' It starts after your current ride.' : ''),
  }));
}

/** The supervisor/admin cancelled a ride this driver had accepted or been given. */
export async function notifyRideCancelled(
  driverId: string,
  ride: { pickupAddress: string; scheduledFor: Date | null },
): Promise<void> {
  await safely(driverId, 'ride_cancelled', () => pushNotice(driverId, {
    kind: 'ride_cancelled',
    screen: 'home',
    title: 'Your ride was cancelled',
    body: `The ride from ${short(ride.pickupAddress)}`
      + (ride.scheduledFor ? ` (${formatIst(ride.scheduledFor)})` : '')
      + ' was cancelled by the supervisor. You do not need to go.',
  }));
}

/** Reminder for a ride the driver claimed or was assigned. */
export async function notifyRideReminder(
  driverId: string,
  ride: { pickupAddress: string; scheduledFor: Date },
  minutesLeft: number,
  isRental = false,
): Promise<void> {
  const mins = Math.max(1, Math.round(minutesLeft));
  const inText = mins >= 120 ? `in about ${Math.round(mins / 60)} hours` : mins >= 60 ? 'in about an hour' : `in ${mins} minutes`;
  await safely(driverId, 'ride_reminder', () => pushNotice(driverId, {
    kind: 'ride_reminder',
    screen: ride.scheduledFor.getTime() - Date.now() > ACTIVE_WINDOW_MS ? 'scheduled' : 'home',
    title: `${isRental ? 'Rental' : 'Ride'} pickup ${inText}`,
    body: `${formatIst(ride.scheduledFor)} · ${short(ride.pickupAddress, 80)}. `
      + (mins <= 45 ? 'You can start the trip now.' : 'Be ready on time.'),
  }));
}

/** The supervisor recorded a UPI payment: the driver should check the UTR and confirm. */
export async function notifyPaymentMarked(
  driverId: string,
  amount: number | null,
  utrLast4: string,
  isRental = false,
): Promise<void> {
  await safely(driverId, 'payment_marked', () => pushNotice(driverId, {
    kind: 'payment_marked',
    screen: 'trips',
    title: amount != null ? `Payment of ₹${amount.toLocaleString('en-IN')} sent` : 'Payment sent',
    body: `The supervisor paid you for the ${isRental ? 'rental' : 'ride'} (UTR ending ${utrLast4}). `
      + 'Check your bank, then confirm receipt in Recent trips.',
  }));
}

/** The supervisor/admin replied in the driver's SOS chat. */
export async function notifySosReply(driverId: string, message: string): Promise<void> {
  await safely(driverId, 'sos_reply', () => pushNotice(driverId, {
    kind: 'sos_reply',
    screen: 'sos',
    title: 'Reply to your SOS',
    body: short(message, 110) || 'Open the chat to read it.',
  }));
}

/** A credit-pack payment completed (confirmed by the payment gateway). */
export async function notifyPurchaseConfirmed(driverId: string, credits: number): Promise<void> {
  await safely(driverId, 'purchase_confirmed', () => pushNotice(driverId, {
    kind: 'purchase_confirmed',
    screen: 'credits',
    title: 'Payment received',
    body: `${credits} ride credits have been added to your account.`,
  }));
}

/** The supervisor cancelled a rental this driver had accepted or started. */
export async function notifyRentalCancelled(
  driverId: string,
  rental: { pickupAddress: string; customerName: string },
): Promise<void> {
  await safely(driverId, 'rental_cancelled', () => pushNotice(driverId, {
    kind: 'rental_cancelled',
    screen: 'home',
    title: 'Your rental was cancelled',
    body: `The rental for ${short(rental.customerName, 30)} at ${short(rental.pickupAddress)} was cancelled by the supervisor.`,
  }));
}

/** Phase 2: the 2-hour face check ran out while the driver is online. */
export async function notifyFaceCheckDue(driverId: string): Promise<void> {
  await safely(driverId, 'face_check_due', () => pushNotice(driverId, {
    kind: 'face_check_due',
    screen: 'facecheck',
    title: 'Face check due — rides paused',
    body: "Take a quick selfie to confirm it's you. You won't get or start rides until you do.",
  }));
}

// ─── Low-credit alert after a ride ───────────────────────────────────────────

/** Credits left at which we warn the driver (and 0 = none left). */
export const CREDITS_LOW_THRESHOLD = 2;

/** True when a balance is one of the two alert levels. */
export function isCreditAlertLevel(remaining: number): boolean {
  return remaining === CREDITS_LOW_THRESHOLD || remaining === 0;
}

async function creditsNow(driverId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT COALESCE(SUM(credits_remaining), 0) AS total
    FROM credit_packs
    WHERE driver_id = ${driverId} AND status = 'active' AND credits_remaining > 0 AND expires_at > NOW()
  `;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Called from inside the ride-completion transaction right after a credit is
 * burned. The push is sent a moment later, and only if the COMMITTED balance
 * still equals `remaining`, so a rolled-back completion can't send a wrong
 * alert. A ride burns its credit once, so each level is crossed once per drop.
 */
export function scheduleLowCreditNotice(driverId: string, remaining: number): void {
  if (!isCreditAlertLevel(remaining)) return;
  const t = setTimeout(() => {
    void safely(driverId, 'credits_low', async () => {
      if ((await creditsNow(driverId)) !== remaining) return;
      await notifyCreditsLow(driverId, remaining);
    });
  }, 2_000);
  t.unref?.();
}
