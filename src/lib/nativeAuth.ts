// Bridges the web driver app's auth tokens down to the native layer so the
// full-screen IncomingRideActivity can Accept/Reject a ride directly against
// the backend even when the web app is killed. No-op on web.
//
// The native WekashiAuth plugin stores { access, refresh, apiBase } in private
// SharedPreferences and refreshes the access token itself when accepting.

import { Capacitor, registerPlugin } from "@capacitor/core";

import type { PluginListenerHandle } from "@capacitor/core";

interface WekashiAuthPlugin {
  saveAuth(opts: { access: string; refresh: string; apiBase: string }): Promise<void>;
  clearAuth(): Promise<void>;
  showOnlineNotification(): Promise<void>;
  hideOnlineNotification(): Promise<void>;
  addListener(event: "wentOffline", cb: () => void): Promise<PluginListenerHandle>;
}

const WekashiAuth = registerPlugin<WekashiAuthPlugin>("WekashiAuth");

/** Absolute API base the native layer calls, e.g. https://wekashi.in/api. */
function apiBase(): string {
  // Same-origin in production (the APK loads https://wekashi.in/driver), so the
  // API is at <origin>/api. Only ever hand native an HTTPS base — native refuses
  // to send tokens over cleartext, and we must not pass it one either.
  try {
    const origin = window.location.origin;
    if (origin.startsWith("https://")) return `${origin}/api`;
  } catch {
    /* ignore */
  }
  return "https://wekashi.in/api";
}

/** Push the current tokens to native. Call on login and after a token refresh. */
export async function syncNativeAuth(access: string | null, refresh: string | null): Promise<void> {
  if (!Capacitor.isNativePlatform?.()) return;
  if (!access || !refresh) return;
  try {
    await WekashiAuth.saveAuth({ access, refresh, apiBase: apiBase() });
  } catch {
    // Non-fatal: native accept/reject just won't be available until next sync.
  }
}

/** Clear native tokens. Call on logout. */
export async function clearNativeAuth(): Promise<void> {
  if (!Capacitor.isNativePlatform?.()) return;
  try {
    await WekashiAuth.clearAuth();
    await WekashiAuth.hideOnlineNotification();
  } catch {
    /* ignore */
  }
}

/** Show/hide the persistent "You're online" notification. No-op on web. */
export async function setOnlineNotification(online: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform?.()) return;
  try {
    if (online) await WekashiAuth.showOnlineNotification();
    else await WekashiAuth.hideOnlineNotification();
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to the native "driver tapped Go Offline on the notification" event.
 * Returns a cleanup fn. No-op on web.
 */
export function onNativeWentOffline(cb: () => void): () => void {
  if (!Capacitor.isNativePlatform?.()) return () => {};
  let handle: PluginListenerHandle | undefined;
  void WekashiAuth.addListener("wentOffline", cb).then((h) => { handle = h; });
  return () => { void handle?.remove(); };
}
