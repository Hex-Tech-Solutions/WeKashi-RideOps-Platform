/// <reference types="google.maps" />
/**
 * MultiGroupMap — draws the routes of SEVERAL groups at once, each in its own
 * colour, for the Group Allocation workspace. Only groups the supervisor has
 * toggled "shown" are drawn as full routes (numbered markers + route line);
 * every other group's members are drawn as faint dots so the whole picture is
 * still visible without the cost of routing every group.
 *
 * This is deliberately separate from RoutePreviewMap (single gold route,
 * read-only) — overloading that component with N colours + per-group polylines
 * would have made it hard to reason about. The office/drop anchor is shared by
 * all groups (they belong to one company/office), drawn once in black.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { loadGoogleMaps } from "@/lib/googleMaps";

export interface MapGroupStop {
  empId: string;
  lat: number;
  lng: number;
  name: string;
}

export interface MapGroup {
  id: string;
  name: string;
  color: string;
  /** Stops in final (optimized) order. */
  stops: MapGroupStop[];
  /** Encoded Google route polyline, if computed; else a straight-line fallback is drawn. */
  polyline: string | null;
  /** login = route ends at office; logout = route starts at office. */
  type: "login" | "logout";
  /** Whether to draw this group's full route (true) or just faint dots (false). */
  shown: boolean;
}

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

export function MultiGroupMap({
  groups,
  office,
  className,
}: {
  groups: MapGroup[];
  office: { name: string; lat: number; lng: number } | null;
  className?: string;
}) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Array<google.maps.Marker | google.maps.Polyline>>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: office ? { lat: office.lat, lng: office.lng } : { lat: 12.95, lng: 77.6 },
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

  // Redraw key — any change to shown groups, their stop order/coords, polylines,
  // colours, or the office triggers a full redraw.
  const drawKey = useMemo(
    () =>
      groups
        .map((grp) =>
          `${grp.id}:${grp.shown ? 1 : 0}:${grp.color}:${grp.type}:${grp.polyline ?? ""}:` +
          grp.stops.map((s) => `${s.empId}@${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join(">"),
        )
        .join("|") + `|${office ? `${office.lat.toFixed(5)},${office.lng.toFixed(5)}` : "noffice"}`,
    [groups, office],
  );

  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = google;

    // Clear previous overlays.
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    const bounds = new g.maps.LatLngBounds();
    let hasAnyPoint = false;

    // Office / drop anchor — shared by all groups.
    if (office) {
      overlaysRef.current.push(new g.maps.Marker({
        map: mapRef.current,
        position: { lat: office.lat, lng: office.lng },
        label: { text: "★", color: "#fff", fontWeight: "700" },
        title: `Office · ${office.name}`,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 12, fillColor: "#111", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
        zIndex: 1000,
      }));
      bounds.extend({ lat: office.lat, lng: office.lng });
      hasAnyPoint = true;
    }

    for (const grp of groups) {
      if (grp.stops.length === 0) continue;

      if (!grp.shown) {
        // Faint dots only — context, no route line.
        for (const s of grp.stops) {
          overlaysRef.current.push(new g.maps.Marker({
            map: mapRef.current!,
            position: { lat: s.lat, lng: s.lng },
            title: `${s.name} · ${grp.name}`,
            icon: { path: g.maps.SymbolPath.CIRCLE, scale: 5, fillColor: grp.color, fillOpacity: 0.35, strokeColor: "#fff", strokeWeight: 1 },
          }));
          bounds.extend({ lat: s.lat, lng: s.lng });
          hasAnyPoint = true;
        }
        continue;
      }

      // Shown group — numbered markers in the group colour.
      grp.stops.forEach((s, i) => {
        overlaysRef.current.push(new g.maps.Marker({
          map: mapRef.current!,
          position: { lat: s.lat, lng: s.lng },
          label: { text: String(i + 1), color: "#fff", fontWeight: "700", fontSize: "11px" },
          title: `${i + 1}. ${s.name} · ${grp.name}`,
          icon: { path: g.maps.SymbolPath.CIRCLE, scale: 12, fillColor: grp.color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2 },
        }));
        bounds.extend({ lat: s.lat, lng: s.lng });
        hasAnyPoint = true;
      });

      // Route line — real polyline if available, else straight-line fallback.
      if (grp.polyline && g.maps.geometry?.encoding) {
        overlaysRef.current.push(new g.maps.Polyline({
          map: mapRef.current!,
          path: g.maps.geometry.encoding.decodePath(grp.polyline),
          strokeColor: grp.color,
          strokeWeight: 4,
          strokeOpacity: 0.9,
        }));
      } else {
        const pts = grp.stops.map((s) => ({ lat: s.lat, lng: s.lng }));
        const path = office
          ? grp.type === "logout"
            ? [{ lat: office.lat, lng: office.lng }, ...pts]
            : [...pts, { lat: office.lat, lng: office.lng }]
          : pts;
        overlaysRef.current.push(new g.maps.Polyline({
          map: mapRef.current!,
          path,
          strokeColor: grp.color,
          strokeWeight: 3,
          strokeOpacity: 0.8,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
        }));
      }
    }

    if (hasAnyPoint) mapRef.current.fitBounds(bounds, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drawKey]);

  return (
    <div className={className}>
      <div className="relative rounded-lg border overflow-hidden bg-muted h-full min-h-[320px]">
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
