/// <reference types="google.maps" />
/**
 * RoutePreviewMap — a compact, READ-ONLY route map.
 *
 * Unlike GoogleRouteMap (which bundles an editable stop list, drag handles,
 * per-stop time pickers etc.), this just draws numbered stop markers + the
 * office + the route line, and redraws whenever the stops or polyline change.
 * Used inside EditGroupDialog so the supervisor can see the route update live
 * as they reorder / add / remove people, without the heavy editing chrome.
 *
 * The polyline, when present, is the real Google Routes API driving route
 * (decoded from the encoded string). If it hasn't arrived yet (or the call
 * failed), a dashed straight-line placeholder is drawn between stops instead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/googleMaps";
import type { RouteResult } from "@/lib/geo";

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export function RoutePreviewMap({
  route,
  type,
  polyline,
  className,
}: {
  route: RouteResult;
  type: "login" | "logout";
  polyline?: string | null;
  className?: string;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const officeMarkerRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: route.drop.point.lat, lng: route.drop.point.lng },
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyle,
        });
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw key — changes whenever the stop order/coords, office, type, or the
  // polyline change, so the map re-renders on every edit.
  const drawKey = useMemo(
    () =>
      route.stops.map((s) => `${s.empId}:${s.point.lat.toFixed(5)},${s.point.lng.toFixed(5)}`).join("|") +
      `|${type}|${route.drop.point.lat.toFixed(5)},${route.drop.point.lng.toFixed(5)}|${polyline ?? ""}`,
    [route.stops, type, route.drop.point.lat, route.drop.point.lng, polyline],
  );

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = (window as any).google as typeof google;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    officeMarkerRef.current?.setMap(null);
    officeMarkerRef.current = null;
    lineRef.current?.setMap(null);

    const office = route.drop.point;
    const stops = route.stops;
    const bounds = new g.maps.LatLngBounds();
    bounds.extend({ lat: office.lat, lng: office.lng });
    stops.forEach((s) => bounds.extend({ lat: s.point.lat, lng: s.point.lng }));

    officeMarkerRef.current = new g.maps.Marker({
      map: mapRef.current,
      position: { lat: office.lat, lng: office.lng },
      label: { text: type === "logout" ? "S" : "★", color: "#fff", fontWeight: "700" },
      title: `${type === "logout" ? "Start" : "Final drop"} · ${route.drop.name}`,
      icon: { path: g.maps.SymbolPath.CIRCLE, scale: 13, fillColor: "#111", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
    });

    stops.forEach((s, i) => {
      markersRef.current.push(new g.maps.Marker({
        map: mapRef.current!,
        position: { lat: s.point.lat, lng: s.point.lng },
        label: { text: String(i + 1), color: "#111", fontWeight: "700" },
        title: `${s.name} · ${s.location}`,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 13, fillColor: "#D5B036", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
      }));
    });

    if (stops.length === 0) {
      mapRef.current.setCenter({ lat: office.lat, lng: office.lng });
      mapRef.current.setZoom(12);
      return;
    }
    mapRef.current.fitBounds(bounds, 40);

    if (polyline && g.maps.geometry?.encoding) {
      lineRef.current = new g.maps.Polyline({
        map: mapRef.current,
        path: g.maps.geometry.encoding.decodePath(polyline),
        strokeColor: "#D5B036",
        strokeWeight: 5,
        strokeOpacity: 0.95,
      });
    } else {
      const ordered =
        type === "logout"
          ? [{ lat: office.lat, lng: office.lng }, ...stops.map((s) => ({ lat: s.point.lat, lng: s.point.lng }))]
          : [...stops.map((s) => ({ lat: s.point.lat, lng: s.point.lng })), { lat: office.lat, lng: office.lng }];
      lineRef.current = new g.maps.Polyline({
        map: mapRef.current,
        path: ordered,
        strokeColor: "#D5B036",
        strokeWeight: 4,
        strokeOpacity: 0.9,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawKey]);

  return (
    <div className={className}>
      <div className="relative rounded-lg border overflow-hidden bg-muted" style={{ aspectRatio: "16 / 9" }}>
        <div ref={mapEl} className="absolute inset-0" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-destructive p-4 text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
