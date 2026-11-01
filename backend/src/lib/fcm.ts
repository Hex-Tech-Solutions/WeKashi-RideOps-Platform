// Firebase Cloud Messaging (FCM) — push notifications to the driver Android app.
//
// This is a BEST-EFFORT layer on top of the Socket.IO ride broadcast: when a
// ride is broadcast we both emit the socket event (instant, foreground) AND
// send an FCM data+notification message (reaches the device even when the app
// is backgrounded or killed). If FCM is not configured, every call here is a
// silent no-op — exactly like the SMS console fallback — so local dev and
// unconfigured environments keep working.
//
// Config (env):
//   FCM_SERVICE_ACCOUNT_JSON  absolute path to the Firebase service-account
//                             private-key JSON (downloaded from Firebase
//                             Console → Project Settings → Service accounts).
//                             This is a SECRET — never commit it.
//
// The service-account JSON is read once at startup. If the path is unset or the
// file can't be read/parsed, FCM stays disabled and we log a single warning.

import { readFileSync } from 'fs';
import { logger } from './logger';

// firebase-admin is imported lazily so the dependency isn't required to boot
// when FCM is disabled (and so a missing/!broken install degrades gracefully).
type Messaging = import('firebase-admin/messaging').Messaging;

let messaging: Messaging | null = null;
let initialized = false;

/** The data payload we attach so the app can deep-link to the ride on tap. */
export interface RidePushData {
  rideId: string;
  type: string; // 'login' | 'logout' | 'rental' | ...
  pickupAddress?: string;
  dropAddress?: string;
}

/**
 * Initialize firebase-admin from the service-account JSON. Idempotent — safe to
 * call repeatedly; only the first call does work. Returns the Messaging client
 * or null when FCM is not configured / failed to initialize.
 */
function getMessaging(): Messaging | null {
  if (initialized) return messaging;
  initialized = true;

  const credsPath = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!credsPath) {
    logger.info('FCM disabled: FCM_SERVICE_ACCOUNT_JSON not set (push notifications off)');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require('firebase-admin') as typeof import('firebase-admin');
    const serviceAccount = JSON.parse(readFileSync(credsPath, 'utf8'));
    const app = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = app.messaging();
    logger.info('FCM enabled: firebase-admin initialized');
    return messaging;
  } catch (err) {
    logger.error({ err }, 'FCM init failed — push notifications disabled');
    messaging = null;
    return null;
  }
}

/** True when FCM is configured and ready to send. */
export function isFcmEnabled(): boolean {
  return getMessaging() !== null;
}

/**
 * Send a ride-broadcast push to a set of device tokens. No-op when FCM is
 * disabled or no tokens are supplied. Returns the list of tokens FCM reported
 * as invalid/unregistered so the caller can clear them from the DB.
 */
export async function sendRideBroadcastPush(
  tokens: string[],
  data: RidePushData,
): Promise<{ staleTokens: string[] }> {
  const client = getMessaging();
  const valid = tokens.filter(Boolean);
  if (!client || valid.length === 0) return { staleTokens: [] };

  const title = data.type === 'rental' ? 'New rental request' : 'New ride available';
  const body = data.pickupAddress
    ? `Pickup: ${data.pickupAddress}`
    : 'Tap to view and accept.';

  // DATA-ONLY message (no `notification` block). This is deliberate: a
  // `notification` payload is handled by the Android system tray and would NOT
  // let our RideFirebaseMessagingService build the full-screen "incoming ride"
  // intent when the app is backgrounded/killed. By sending data-only at HIGH
  // priority, every message is delivered to our onMessageReceived(), which then
  // raises the full-screen call-style Activity (IncomingRideActivity).
  const dataPayload: Record<string, string> = {
    kind: 'ride_broadcast',
    rideId: data.rideId,
    type: data.type,
    title,
    body,
  };
  if (data.pickupAddress) dataPayload.pickupAddress = data.pickupAddress;
  if (data.dropAddress) dataPayload.dropAddress = data.dropAddress;

  try {
    const res = await client.sendEachForMulticast({
      tokens: valid,
      data: dataPayload,
      android: {
        // HIGH priority wakes the device from Doze so the full-screen alert
        // fires promptly even when idle. Required for a ride-offer alert.
        priority: 'high',
      },
    });

    // Collect tokens FCM says are permanently invalid so we can prune them.
    const staleTokens: string[] = [];
    res.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code ?? '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) {
        staleTokens.push(valid[i]);
      }
    });

    if (res.failureCount > 0) {
      logger.warn(
        { success: res.successCount, failure: res.failureCount, stale: staleTokens.length },
        'FCM multicast had failures',
      );
    }
    return { staleTokens };
  } catch (err) {
    logger.error({ err, rideId: data.rideId }, 'FCM send failed');
    return { staleTokens: [] };
  }
}
