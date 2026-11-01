// Driver push-notification wiring (FCM via @capacitor/push-notifications).
//
// Runs ONLY on the native Android app. The same React bundle also serves the
// driver console in a desktop browser, where this plugin isn't available — so
// every function here is a safe no-op off-native. Ride broadcasts still arrive
// via Socket.IO regardless; push is the background/killed-app delivery layer.
//
// Lifecycle:
//   initPushNotifications()  — call after driver login. Requests permission,
//                              registers with FCM, and POSTs the token to the
//                              backend. Also wires tap-to-open-ride handling.
//   teardownPushNotifications() — call on logout. Removes listeners.

import { Capacitor } from "@capacitor/core";
import { registerPushToken } from "@/lib/api";

let initialized = false;
let registrationCleanup: (() => void) | null = null;

/** True only inside the native Android app where the push plugin exists. */
function isNative(): boolean {
  return Capacitor.isNativePlatform?.() === true;
}

/**
 * Request permission, register with FCM, and send the device token to the
 * backend. Also handles an incoming notification tap (deep-link to the ride).
 * No-op on web / when already initialized.
 *
 * @param onOpenRide optional — invoked with a rideId when the driver taps a
 *                   ride-broadcast notification, so the app can navigate to it.
 */
export async function initPushNotifications(
  onOpenRide?: (rideId: string) => void,
): Promise<void> {
  if (!isNative() || initialized) return;
  initialized = true;

  // Lazy import so the plugin is never pulled into the web bundle path.
  const { PushNotifications } = await import("@capacitor/push-notifications");

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") {
    // Driver declined — stay on Socket.IO-only delivery.
    initialized = false;
    return;
  }

  const onRegistration = await PushNotifications.addListener("registration", (tok) => {
    // tok.value is the FCM registration token for this device.
    void registerPushToken(tok.value);
  });

  const onRegError = await PushNotifications.addListener("registrationError", (err) => {
    // Non-fatal — the driver still gets Socket.IO broadcasts.
    // eslint-disable-next-line no-console
    console.warn("Push registration error", err);
  });

  const onTap = await PushNotifications.addListener(
    "pushNotificationActionPerformed",
    (action) => {
      const data = action.notification?.data as { kind?: string; rideId?: string } | undefined;
      if (data?.kind === "ride_broadcast" && data.rideId && onOpenRide) {
        onOpenRide(data.rideId);
      }
    },
  );

  registrationCleanup = () => {
    void onRegistration.remove();
    void onRegError.remove();
    void onTap.remove();
  };

  // Kicks off the native registration → fires the "registration" listener above.
  await PushNotifications.register();
}

/** Remove push listeners. Call on logout. No-op on web. */
export async function teardownPushNotifications(): Promise<void> {
  if (!isNative()) return;
  registrationCleanup?.();
  registrationCleanup = null;
  initialized = false;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  await PushNotifications.removeAllListeners();
}
