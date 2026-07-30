import { Capacitor } from "@capacitor/core";

export interface Coords { lat: number; lng: number }

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

// Continuous position updates. Returns a cleanup function that stops the watch.
export function watchDevicePosition(onUpdate: (c: Coords) => void): () => void {
  if (Capacitor.isNativePlatform()) {
    let watchId: string | null = null;
    let cancelled = false;
    import("@capacitor/geolocation").then(async ({ Geolocation }) => {
      if (cancelled) return;
      watchId = await Geolocation.watchPosition({ enableHighAccuracy: true }, (pos) => {
        if (pos) onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      });
    });
    return () => {
      cancelled = true;
      if (watchId) import("@capacitor/geolocation").then(({ Geolocation }) => Geolocation.clearWatch({ id: watchId! }));
    };
  }
  if (!("geolocation" in navigator)) return () => undefined;
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
