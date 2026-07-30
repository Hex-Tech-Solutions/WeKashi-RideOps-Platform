/// <reference types="google.maps" />
// Async loader for the Google Maps JS API.
// Caches the promise so multiple components share a single script load.

let loadPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if ((window as any).google?.maps) return Promise.resolve((window as any).google);
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  if (!key) {
    return Promise.reject(
      new Error("Google Maps API key not configured. Add VITE_GOOGLE_MAPS_KEY to your .env file."),
    );
  }

  loadPromise = new Promise((resolve, reject) => {
    (window as any).__rideopsInitMap = () => resolve((window as any).google);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&loading=async&libraries=places&callback=__rideopsInitMap`;
    script.async = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load Google Maps script"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
