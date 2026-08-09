/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import type { LiveDriver } from "@/lib/queries";

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// Real-time map of every online cab, driven by /drivers/live-locations.
export function LiveCabMap({ drivers, height = 520 }: { drivers: LiveDriver[]; height?: number }) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Boot the map once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: 12.9716, lng: 77.5946 }, // Bangalore fallback
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyle,
        });
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Sync markers with the driver list.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = (window as any).google as typeof google;
    const map = mapRef.current;
    const seen = new Set<string>();
    const bounds = new g.maps.LatLngBounds();

    drivers.forEach((d) => {
      seen.add(d.id);
      const pos = { lat: d.lat, lng: d.lng };
      bounds.extend(pos);
      const color = d.status === "active" ? "#D5B036" : "#6b7280";
      let marker = markersRef.current.get(d.id);
      if (!marker) {
        marker = new g.maps.Marker({ map, position: pos });
        markersRef.current.set(d.id, marker);
      }
      marker.setPosition(pos);
      marker.setTitle(`${d.fullName}${d.vehicleType ? ` · ${d.vehicleType}` : ""} · ${d.status}`);
      marker.setIcon({
        path: g.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 2,
      });
      marker.setLabel({ text: "🚖", fontSize: "12px" });
    });

    // Remove markers for drivers no longer online.
    markersRef.current.forEach((marker, id) => {
      if (!seen.has(id)) { marker.setMap(null); markersRef.current.delete(id); }
    });

    if (drivers.length > 0) map.fitBounds(bounds, 80);
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
