/**
 * Send every driver notification to ONE driver's phone, to check wording,
 * delivery and tap-to-open — without touching any data.
 *
 *   node dist/scripts/sendTestNotices.js <phone> [--list] [--only a,b] [--skip a,b] [--delay 6000]
 *
 * It calls the same notify* functions the real flows use, so the text and the
 * screen a tap opens are exactly what drivers get. Each title is prefixed
 * "[TEST] ". It does NOT run the triggers (assigning a ride, KYC review, the
 * sweepers…) and writes nothing to the database. The only possible write is the
 * normal stale-token cleanup if Firebase says the phone's push token is dead.
 */
import { prisma } from '../lib/prisma';
import { isFcmEnabled } from '../lib/fcm';
import {
  notifyDocumentRejected, notifyDocumentExpiring, notifyDocumentExpired, notifyKycApproved,
  notifyAccountSuspended, notifyAccountReactivated, notifyAccountRemoved, notifyCreditsLow,
  notifyPackExpiring, notifyRideAssigned, notifyRideCancelled, notifyRideReminder,
  notifyPaymentMarked, notifySosReply, notifyPurchaseConfirmed, notifyRentalCancelled,
  notifyFaceCheckDue,
} from '../services/driverNotice.service';

process.env.NOTICE_TEST_PREFIX = '[TEST] ';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const inFuture = (ms: number) => new Date(Date.now() + ms);

interface Case { key: string; opens: string; run: (driverId: string, token: string) => Promise<void> }

const SAMPLE_PICKUP = 'Embassy Tech Village, Outer Ring Road, Bengaluru';
const SAMPLE_DROP = 'Kempegowda Airport, Devanahalli';

const CASES: Case[] = [
  { key: 'document_rejected', opens: 'Documents tab', run: (id) => notifyDocumentRejected(id, 'insurance', 'Photo is blurry') },
  { key: 'document_expiring', opens: 'Documents tab', run: (id) => notifyDocumentExpiring(id, 'puc', 7) },
  { key: 'document_expired', opens: 'Documents tab', run: (id) => notifyDocumentExpired(id, 'dl') },
  { key: 'kyc_approved_bonus', opens: 'Ride Credits', run: (id) => notifyKycApproved(id, 5) },
  { key: 'kyc_approved', opens: 'Home', run: (id) => notifyKycApproved(id, 0) },
  { key: 'account_suspended', opens: 'Home', run: (id) => notifyAccountSuspended(id) },
  { key: 'account_reactivated', opens: 'Home', run: (id) => notifyAccountReactivated(id) },
  { key: 'account_removed', opens: 'nothing', run: (id, token) => notifyAccountRemoved(id, token) },
  { key: 'credits_low', opens: 'Ride Credits', run: (id) => notifyCreditsLow(id, 2) },
  { key: 'credits_zero', opens: 'Ride Credits', run: (id) => notifyCreditsLow(id, 0) },
  { key: 'pack_expiring', opens: 'Ride Credits', run: (id) => notifyPackExpiring(id, 12, 7, '27 Nov 2026') },
  { key: 'ride_assigned_later', opens: 'Scheduled tab', run: (id) => notifyRideAssigned(id, { pickupAddress: SAMPLE_PICKUP, dropAddress: SAMPLE_DROP, scheduledFor: inFuture(5 * HOUR) }, false) },
  { key: 'ride_assigned_now', opens: 'Home', run: (id) => notifyRideAssigned(id, { pickupAddress: SAMPLE_PICKUP, dropAddress: SAMPLE_DROP, scheduledFor: null }, true) },
  { key: 'ride_cancelled', opens: 'Home', run: (id) => notifyRideCancelled(id, { pickupAddress: SAMPLE_PICKUP, scheduledFor: inFuture(5 * HOUR) }) },
  { key: 'ride_reminder_2h', opens: 'Scheduled tab', run: (id) => notifyRideReminder(id, { pickupAddress: SAMPLE_PICKUP, scheduledFor: inFuture(2 * HOUR) }, 120) },
  { key: 'ride_reminder_45m', opens: 'Home', run: (id) => notifyRideReminder(id, { pickupAddress: SAMPLE_PICKUP, scheduledFor: inFuture(40 * MIN) }, 40) },
  { key: 'rental_reminder', opens: 'Home', run: (id) => notifyRideReminder(id, { pickupAddress: SAMPLE_PICKUP, scheduledFor: inFuture(40 * MIN) }, 40, true) },
  { key: 'payment_marked', opens: 'Recent trips', run: (id) => notifyPaymentMarked(id, 650, '4821') },
  { key: 'payment_marked_rental', opens: 'Recent trips', run: (id) => notifyPaymentMarked(id, 1800, '7730', true) },
  { key: 'sos_reply', opens: 'SOS chat (if one is open)', run: (id) => notifySosReply(id, 'We have seen your alert. Are you safe? Reply here.') },
  { key: 'purchase_confirmed', opens: 'Ride Credits', run: (id) => notifyPurchaseConfirmed(id, 5) },
  { key: 'rental_cancelled', opens: 'Home', run: (id) => notifyRentalCancelled(id, { pickupAddress: SAMPLE_PICKUP, customerName: 'Test Customer' }) },
  { key: 'face_check_due', opens: 'Face check screen', run: (id) => notifyFaceCheckDue(id) },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (process.argv.includes('--list')) {
    for (const c of CASES) console.log(`${c.key.padEnd(24)} tap opens: ${c.opens}`);
    return;
  }

  const phone = process.argv[2];
  if (!phone || phone.startsWith('--')) {
    console.error('Usage: node dist/scripts/sendTestNotices.js <+91phone> [--only a,b] [--skip a,b] [--delay 6000] | --list');
    process.exitCode = 1;
    return;
  }

  const only = csv(arg('--only'));
  const skip = csv(arg('--skip'));
  const unknown = [...only, ...skip].filter((k) => !CASES.some((c) => c.key === k));
  if (unknown.length) {
    console.error(`Unknown notice(s): ${unknown.join(', ')}. Use --list to see the names.`);
    process.exitCode = 1;
    return;
  }
  const delay = Math.max(1500, Number(arg('--delay') ?? 6000));

  if (!isFcmEnabled()) {
    console.error('Firebase push is NOT configured in this container (FCM_SERVICE_ACCOUNT_JSON). Nothing was sent.');
    process.exitCode = 1;
    return;
  }

  const driver = await prisma.driver.findFirst({
    where: { phone, status: { notIn: ['removed', 'rejected'] } },
    select: { id: true, fullName: true, status: true, fcmToken: true },
  });
  if (!driver) {
    console.error(`No live driver with phone ${phone}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Driver: ${driver.fullName} (${driver.status})`);
  if (!driver.fcmToken) {
    console.error('This driver has no push token. Open the driver app on the phone and sign in once, then run this again. Nothing was sent.');
    process.exitCode = 1;
    return;
  }

  const todo = CASES.filter((c) => (only.length ? only.includes(c.key) : true) && !skip.includes(c.key));
  console.log(`Sending ${todo.length} test notice(s), ${delay / 1000}s apart. Keep the app in the BACKGROUND (or closed) and watch the phone.\n`);

  let n = 0;
  for (const c of todo) {
    n++;
    console.log(`${String(n).padStart(2)}/${todo.length}  ${c.key.padEnd(24)} tap opens: ${c.opens}`);
    await c.run(driver.id, driver.fcmToken);
    if (n < todo.length) await sleep(delay);
  }
  console.log('\nDone. Anything that did not arrive: check the API log for "FCM notice send failed" or "Driver notice failed".');
}

main()
  .catch((err) => { console.error('Failed:', err?.message ?? err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect().catch(() => undefined); process.exit(process.exitCode ?? 0); });
