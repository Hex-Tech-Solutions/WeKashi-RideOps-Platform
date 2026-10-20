import { Capacitor, registerPlugin } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";

export interface Coords { lat: number; lng: number }

// Acquire the native plugin instance by its registered name, typed via the
// package's exported interface. (The package's type entry exports interfaces
// only; the runtime object is a Capacitor-registered plugin, so registerPlugin
// is the stable way to get a typed handle without depending on its JS export
// shape.) Lazily created so the web bundle never touches native code.
let _bgGeo: BackgroundGeolocationPlugin | null = null;
function bgGeo(): BackgroundGeolocationPlugin {
  if (!_bgGeo) _bgGeo = registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");
  return _bgGeo;
}

// One-shot current position. On the native app this uses Android's GPS via the
// Capacitor plugin (works over HTTP); in a browser it uses navigator.geolocation
// (which requires a secure/https context).
export async function getDevicePosition(): Promise<Coords> {
  if (Capacitor.isNativePlatform()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const perm = await Geolocation.requestPermissions();
    if (perm.location === "denied") throw new Error("Location permission denied — enable GPS to go online");
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Location not supported on this device"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "Location permission denied — enable GPS to go online" : "Could not get your location")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    );
  });
}

// ─── Continuous position updates ───────────────────────────────────────────────
//
// Returns a cleanup function that stops the watch.
//
// On a NATIVE device this uses @capacitor-community/background-geolocation, which
// runs an Android foreground service (persistent notification) that KEEPS
// emitting positions while the app is backgrounded — e.g. while the driver is in
// Google Maps navigating. The default @capacitor/geolocation watch (and the
// WebView itself) are suspended when the app loses focus, which froze the live
// map and starved the trip odometer of breadcrumbs. Background-geolocation fixes
// both because every consumer (admin live map, supervisor tracker, nearby-driver
// matching, ride trail, rental odometer) reads from the same current_location /
// *_location_logs that these pings feed via /driver/location.
//
// On the WEB (supervisor console, testing) it falls back to navigator.geolocation
// (foreground only — there's no background concept in a browser tab).

const BG_DISTANCE_FILTER_M = 20; // emit after ~20m of movement (map fluid, battery sane)

export function watchDevicePosition(onUpdate: (c: Coords) => void): () => void {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BackgroundGeolocation")) {
    let watcherId: string | null = null;
    let cancelled = false;
    let foregroundFallbackStop: (() => void) | null = null;

    // addWatcher resolves with the watcher id; the callback fires on every
    // position (foreground AND background, via the Android foreground service).
    bgGeo().addWatcher(
      {
        // Presence of backgroundMessage is what enables background delivery, and
        // Android shows it in the required persistent notification.
        backgroundMessage: "Sharing your live location while you're online.",
        backgroundTitle: "Wekashi Cabs",
        requestPermissions: true,
        stale: false,
        distanceFilter: BG_DISTANCE_FILTER_M,
      },
      (location, error) => {
        if (error) return; // permission denied / transient — keep the watcher alive
        if (location) onUpdate({ lat: location.latitude, lng: location.longitude });
      },
    ).then((id) => {
      watcherId = id;
      if (cancelled) void bgGeo().removeWatcher({ id }); // torn down before it resolved
    }).catch(() => {
      // Plugin failed to start (e.g. permission hard-denied) — fall back to the
      // foreground watch so at least in-app tracking works.
      if (!cancelled) foregroundFallbackStop = startForegroundWatch(onUpdate);
    });

    return () => {
      cancelled = true;
      if (foregroundFallbackStop) { foregroundFallbackStop(); foregroundFallbackStop = null; }
      if (watcherId) void bgGeo().removeWatcher({ id: watcherId }).catch(() => undefined);
    };
  }

  // Web (or native without the plugin): foreground-only browser geolocation.
  return startForegroundWatch(onUpdate);
}

// ─── Battery-optimization / permissions settings ──────────────────────────────
//
// Opens the app's Android settings page (where "Allow all the time" location and
// battery-optimization exemption live). No-op on web. Used by the first-run
// background-reliability prompt — Android OEMs (Xiaomi/Oppo/etc.) aggressively
// kill backgrounded apps unless the user exempts them, which otherwise freezes
// live tracking the moment the driver switches to Google Maps.
export async function openAppSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("BackgroundGeolocation")) return;
  try {
    await bgGeo().openSettings();
  } catch {
    // openSettings can reject if no activity handles the intent — ignore.
  }
}

// ─── Best-effort "going offline" beacon ───────────────────────────────────────
//
// Fired when the app is gracefully backgrounded/closed (pagehide) while online.
// Tells the server to flip the driver offline immediately instead of waiting for
// the 3-min staleness sweep. Uses fetch keepalive so the request survives page
// unload (sendBeacon can't carry the Authorization header). This is only a fast
// path for GRACEFUL exits — a hard swipe-kill won't fire it, which is exactly why
// the server-side staleness sweeper remains the real guarantee.
export function sendOfflineBeacon(accessToken: string | null): void {
  if (!accessToken) return;
  try {
    void fetch("/api/driver/offline", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      keepalive: true,
    });
  } catch {
    // Unload path — nothing we can do if it fails; the sweeper backstops it.
  }
}

// Browser navigator.geolocation watch — foreground only. Used on the web and as
// a fallback if the native background plugin can't start.
function startForegroundWatch(onUpdate: (c: Coords) => void): () => void {
  if (!("geolocation" in navigator)) return () => undefined;
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
