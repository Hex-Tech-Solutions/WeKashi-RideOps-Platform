/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { loadGoogleMaps } from "@/lib/googleMaps";
import type { LiveDriver } from "@/lib/queries";

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

const ACTIVE_COLOR = "#D5B036";
const OTHER_COLOR = "#6b7280";

const pinIcon = (g: typeof google, color: string): google.maps.Symbol => ({
  path: g.maps.SymbolPath.CIRCLE,
  scale: 7,
  fillColor: color,
  fillOpacity: 1,
  strokeColor: "#fff",
  strokeWeight: 2,
});

interface Pin { marker: google.maps.Marker; lat: number; lng: number; color: string }

// Real-time map of every online cab, driven by /drivers/live-locations.
//
// Built for thousands of cabs (load test, Nov 2026: the old version drew a
// labelled pin per driver and restyled every one of them on each 10 s refresh;
// with ~3,000 online the browser froze with "page not responding"):
//   - nearby cabs are grouped into numbered bubbles that split as you zoom in
//   - a pin is created once; later refreshes only move pins that actually moved
//     and recolour pins whose status changed
//   - the map zooms to fit the cabs once, then leaves the view to the admin
export function LiveCabMap({ drivers, height = 520 }: { drivers: LiveDriver[]; height?: number }) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const pinsRef = useRef<Map<string, Pin>>(new Map());
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Boot the map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        const map = new g.maps.Map(mapEl.current, {
          center: { lat: 12.9716, lng: 77.5946 }, // Bangalore fallback
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyle,
        });
        mapRef.current = map;
        clustererRef.current = new MarkerClusterer({ map });
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      pinsRef.current.clear();
    };
  }, []);

  // Sync pins with the driver list: add new, move/recolour changed, drop gone.
  useEffect(() => {
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!ready || !map || !clusterer) return;
    const g = (window as any).google as typeof google;
    const pins = pinsRef.current;
    const seen = new Set<string>();
    const added: google.maps.Marker[] = [];
    let changed = false;

    for (const d of drivers) {
      seen.add(d.id);
      const color = d.status === "active" ? ACTIVE_COLOR : OTHER_COLOR;
      const pin = pins.get(d.id);
      if (!pin) {
        const marker = new g.maps.Marker({
          position: { lat: d.lat, lng: d.lng },
          icon: pinIcon(g, color),
          title: `${d.fullName}${d.vehicleType ? ` · ${d.vehicleType}` : ""} · ${d.status}`,
        });
        pins.set(d.id, { marker, lat: d.lat, lng: d.lng, color });
        added.push(marker);
        continue;
      }
      if (pin.lat !== d.lat || pin.lng !== d.lng) {
        pin.marker.setPosition({ lat: d.lat, lng: d.lng });
        pin.lat = d.lat;
        pin.lng = d.lng;
        changed = true;
      }
      if (pin.color !== color) {
        pin.marker.setIcon(pinIcon(g, color));
        pin.marker.setTitle(`${d.fullName}${d.vehicleType ? ` · ${d.vehicleType}` : ""} · ${d.status}`);
        pin.color = color;
      }
    }

    const removed: google.maps.Marker[] = [];
    pins.forEach((pin, id) => {
      if (!seen.has(id)) { removed.push(pin.marker); pins.delete(id); }
    });

    // Batch every change into one cluster redraw.
    if (added.length) clusterer.addMarkers(added, true);
    if (removed.length) clusterer.removeMarkers(removed, true);
    if (added.length || removed.length || changed) clusterer.render();

    if (!fittedRef.current && drivers.length > 0) {
      const bounds = new g.maps.LatLngBounds();
      for (const d of drivers) bounds.extend({ lat: d.lat, lng: d.lng });
      map.fitBounds(bounds, 80);
      fittedRef.current = true;
    }
  }, [ready, drivers]);

  return (
    <div className="relative rounded-lg border overflow-hidden bg-muted" style={{ height }}>
      <div ref={mapEl} className="absolute inset-0" />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive p-6 text-center">
          {error}<br />Add VITE_GOOGLE_MAPS_KEY to .env.prod and redeploy.
        </div>
      )}
      {ready && !error && (
        <div className="absolute bottom-3 left-3 bg-card/95 rounded-md px-3 py-2 text-xs flex items-center gap-3 border shadow-sm">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-gold" /> Active</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-muted-foreground" /> Online (other)</span>
          <span className="text-muted-foreground">{drivers.length} cab{drivers.length === 1 ? "" : "s"} online</span>
        </div>
      )}
    </div>
  );
}