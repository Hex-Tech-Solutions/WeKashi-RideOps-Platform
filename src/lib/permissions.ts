// Driver permissions bridge for the Step 4 onboarding checklist.
//
// Combines:
//  - native special-access checks/openers (overlay, battery, full-screen-intent,
//    OEM autostart) via the WekashiPermissions plugin, and
//  - runtime-dialog permissions (notifications, location) via the existing
//    @capacitor/push-notifications and @capacitor/geolocation plugins.
//
// Everything is a safe no-op on web (returns "granted"/unknown) so the driver
// console still runs in a browser.

import { Capacitor, registerPlugin } from "@capacitor/core";

interface PermissionsNative {
  checkPermissions(): Promise<{
    notifications: boolean;
    overlay: boolean;
    batteryUnrestricted: boolean;
    fullScreenIntent: boolean;
    brand: string;
  }>;
  openSetting(opts: { key: "overlay" | "battery" | "fullScreenIntent" | "notifications" | "appDetails" }): Promise<void>;
  openAutostartSettings(): Promise<{ brand: string; opened: boolean }>;
}

const Native = registerPlugin<PermissionsNative>("WekashiPermissions");

export type PermKey =
  | "notifications"
  | "location"
  | "backgroundLocation"
  | "overlay"
  | "battery"
  | "fullScreenIntent"
  | "autostart";

export interface PermStatus {
  notifications: boolean;
  location: boolean;
  backgroundLocation: boolean;
  overlay: boolean;
  battery: boolean;
  fullScreenIntent: boolean;
  /** Autostart can't be detected programmatically — always "unknown" (null). */
  autostart: null;
  brand: string;
}

const isNative = () => Capacitor.isNativePlatform?.() === true;

/** Read the current status of every permission. On web, reports all granted. */
export async function checkAllPermissions(): Promise<PermStatus> {
  if (!isNative()) {
    return {
      notifications: true, location: true, backgroundLocation: true,
      overlay: true, battery: true, fullScreenIntent: true, autostart: null, brand: "",
    };
  }
  const [native, loc, bg] = await Promise.all([
    Native.checkPermissions().catch(() => ({
      notifications: false, overlay: false, batteryUnrestricted: false, fullScreenIntent: false, brand: "",
    })),
    checkLocation(),
    checkBackgroundLocation(),
  ]);
  return {
    notifications: native.notifications,
    location: loc,
    backgroundLocation: bg,
    overlay: native.overlay,
    battery: native.batteryUnrestricted,
    fullScreenIntent: native.fullScreenIntent,
    autostart: null,
    brand: native.brand,
  };
}

async function checkLocation(): Promise<boolean> {
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const s = await Geolocation.checkPermissions();
    return s.location === "granted" || s.coarseLocation === "granted";
  } catch { return false; }
}

async function checkBackgroundLocation(): Promise<boolean> {
  // The @capacitor/geolocation plugin reports only foreground location; the
  // "all the time" grant isn't readable via a simple API, so we approximate:
  // if foreground location is granted we treat background as "check in settings"
  // — the UI shows a guidance step rather than a hard ✓. Returning false keeps
  // it as an actionable row.
  return false;
}

/** Request notifications (Android 13+ runtime dialog). */
export async function requestNotifications(): Promise<void> {
  if (!isNative()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.requestPermissions();
  } catch { /* ignore */ }
}

/** Request foreground location (runtime dialog). */
export async function requestLocation(): Promise<void> {
  if (!isNative()) return;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    await Geolocation.requestPermissions();
  } catch { /* ignore */ }
}

/** Open a native special-access settings page. */
export async function openSetting(
  key: "overlay" | "battery" | "fullScreenIntent" | "notifications" | "appDetails",
): Promise<void> {
  if (!isNative()) return;
  try { await Native.openSetting({ key }); } catch { /* ignore */ }
}

/** Open the OEM autostart page (best-effort). Returns the brand for guidance. */
export async function openAutostart(): Promise<{ brand: string; opened: boolean }> {
  if (!isNative()) return { brand: "", opened: false };
  try { return await Native.openAutostartSettings(); } catch { return { brand: "", opened: false }; }
}
