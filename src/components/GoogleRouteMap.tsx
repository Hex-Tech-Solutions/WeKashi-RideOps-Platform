/// <reference types="google.maps" />
import { useEffect, useMemo, useRef, useState } from "react";
import { GripVertical, X, Plus, MapPin, Loader2, Move, ChevronUp, ChevronDown } from "lucide-react";
import { TimeSelect } from "@/components/TimeSelect";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { coordPoint } from "@/lib/geo";
import type { RouteResult, RouteStop } from "@/lib/geo";

interface Props {
  route: RouteResult;
  type?: "login" | "logout";
  editable?: boolean;
  onReorder?: (from: number, to: number) => void;
  onRemove?: (empId: string) => void;
  onAdd?: () => void;
  /** Called when an employee pickup pin is dragged to a new position. */
  onPinMoved?: (empId: string, lat: number, lng: number, address: string) => void;
  /** Called when the office / drop pin is dragged to a new position. */
  onOfficeMoved?: (lat: number, lng: number, address: string) => void;
  /** Current per-stop expected pickup times — empId → HH:MM */
  pickupTimes?: Record<string, string>;
  /** Called when the supervisor changes a stop's expected pickup time */
  onPickupTimeChange?: (empId: string, time: string) => void;
  /** Allowed HH:MM range for per-stop pickup times, derived from the group's shift time. */
  pickupTimeWindow?: { min: string; max: string } | null;
  /** Encoded polyline from the backend's Routes API call, for the CURRENT stop order. Drawn as-is (no client-side Directions call). */
  polyline?: string | null;
  /** True while the backend is computing/re-computing the route for the current stops. */
  routeLoading?: boolean;
}

// ─── Reverse geocode helper ───────────────────────────────────────────────────

async function reverseGeocode(
  geocoder: google.maps.Geocoder,
  lat: number,
  lng: number,
): Promise<string> {
  try {
    const result = await geocoder.geocode({ location: { lat, lng } });
    return result.results[0]?.formatted_address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GoogleRouteMap({
  route,
  type = "login",
  editable,
  onReorder,
  onRemove,
  onAdd,
  onPinMoved,
  onOfficeMoved,
  pickupTimes,
  onPickupTimeChange,
  pickupTimeWindow,
  polyline,
  routeLoading,
}: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const officeMarkerRef = useRef<google.maps.Marker | null>(null);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // ── Boot the map once ──────────────────────────────────────────────────────
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
        geocoderRef.current = new g.maps.Geocoder();
        setReady(true);
      })
      .catch((e) => setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopsKey = useMemo(
    () =>
      route.stops
        .map((s) => `${s.empId}:${s.point.lat.toFixed(5)},${s.point.lng.toFixed(5)}`)
        .join("|") +
      ":" +
      type,
    [route.stops, type],
  );

  // ── Redraw markers + route whenever stops or office change ─────────────────
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const g = (window as any).google as typeof google;

    // Clear old markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    officeMarkerRef.current?.setMap(null);
    officeMarkerRef.current = null;
    polylineRef.current?.setMap(null);

    const office = route.drop.point;
    const stops = route.stops;
    const isDraggable = !!editable;

    // Bounds
    const bounds = new g.maps.LatLngBounds();
    bounds.extend({ lat: office.lat, lng: office.lng });
    stops.forEach((s) => bounds.extend({ lat: s.point.lat, lng: s.point.lng }));

    // ── Office marker ──────────────────────────────────────────────────────
    const officeLabel = type === "logout" ? "S" : "★";
    const officeMarker = new g.maps.Marker({
      map: mapRef.current,
      position: { lat: office.lat, lng: office.lng },
      draggable: isDraggable && !!onOfficeMoved,
      cursor: isDraggable && onOfficeMoved ? "grab" : "default",
      label: { text: officeLabel, color: "#fff", fontWeight: "700" },
      title: `${type === "logout" ? "Start" : "Final drop"} · ${route.drop.name}${isDraggable && onOfficeMoved ? " — drag to adjust" : ""}`,
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 14,
        fillColor: "#111",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 3,
      },
    });

    if (isDraggable && onOfficeMoved && geocoderRef.current) {
      const geocoder = geocoderRef.current;
      officeMarker.addListener("dragend", async () => {
        const pos = officeMarker.getPosition();
        if (!pos) return;
        const lat = pos.lat();
        const lng = pos.lng();
        const address = await reverseGeocode(geocoder, lat, lng);
        onOfficeMoved(lat, lng, address);
      });
    }

    officeMarkerRef.current = officeMarker;

    // ── Employee stop markers ──────────────────────────────────────────────
    stops.forEach((s, i) => {
      const marker = new g.maps.Marker({
        map: mapRef.current,
        position: { lat: s.point.lat, lng: s.point.lng },
        draggable: isDraggable && !!onPinMoved,
        cursor: isDraggable && onPinMoved ? "grab" : "default",
        label: { text: String(i + 1), color: "#111", fontWeight: "700" },
        title: `${s.name} · ${s.location}${isDraggable && onPinMoved ? " — drag to adjust" : ""}`,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 14,
          fillColor: "#D5B036",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 3,
        },
      });

      if (isDraggable && onPinMoved && geocoderRef.current) {
        const geocoder = geocoderRef.current;
        const empId = s.empId;
        marker.addListener("dragend", async () => {
          const pos = marker.getPosition();
          if (!pos) return;
          const lat = pos.lat();
          const lng = pos.lng();
          const address = await reverseGeocode(geocoder, lat, lng);
          onPinMoved(empId, lat, lng, address);
        });
      }

      markersRef.current.push(marker);
    });

    if (stops.length === 0) {
      mapRef.current.setCenter({ lat: office.lat, lng: office.lng });
      mapRef.current.setZoom(12);
      return;
    }

    mapRef.current.fitBounds(bounds, 60);

    // ── Route line — drawn from the backend-provided polyline ──────────────
    // The backend (Google Routes API) already computed the real driving
    // route for the current stop order; we just decode + draw it here. No
    // client-side Directions/Routes call happens in this component anymore.
    const ordered =
      type === "logout"
        ? [{ lat: office.lat, lng: office.lng }, ...stops.map((s) => ({ lat: s.point.lat, lng: s.point.lng }))]
        : [...stops.map((s) => ({ lat: s.point.lat, lng: s.point.lng })), { lat: office.lat, lng: office.lng }];

    if (polyline && g.maps.geometry?.encoding) {
      const path = g.maps.geometry.encoding.decodePath(polyline);
      polylineRef.current = new g.maps.Polyline({
        map: mapRef.current,
        path,
        strokeColor: "#D5B036",
        strokeWeight: 5,
        strokeOpacity: 0.95,
      });
    } else {
      // No polyline yet (still loading, or the backend call failed) — draw a
      // dashed straight-line placeholder between stops in the current order.
      polylineRef.current = new g.maps.Polyline({
        map: mapRef.current,
        path: ordered,
        strokeColor: "#D5B036",
        strokeWeight: 4,
        strokeOpacity: 0.9,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
      });
    }
  }, [
    ready,
    stopsKey,
    route.drop.point.lat,
    route.drop.point.lng,
    route.drop.name,
    type,
    editable,
    onPinMoved,
    onOfficeMoved,
    polyline,
  ]);

  const totalKm = route.totalKm;
  const etaMin = route.etaMin;
  const officeLabelText = type === "logout" ? "Start" : "Final drop";
  const showDragHint = editable && (!!onPinMoved || !!onOfficeMoved);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Map canvas */}
      <div className="relative rounded-lg border overflow-hidden bg-muted" style={{ aspectRatio: "2 / 1" }}>
        <div ref={mapEl} className="absolute inset-0" />

        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive p-6 text-center">
            {error}
          </div>
        )}

        {ready && (
          <>
            <div className="absolute bottom-3 left-3 bg-card/95 rounded-md px-3 py-2 text-xs flex items-center gap-3 border shadow-sm">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-gold" />
                {type === "logout" ? "Drop" : "Pickup"}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-foreground" />
                {officeLabelText}: {route.drop.name}
              </span>
            </div>

            <div className="absolute top-3 right-3 bg-card/95 rounded-md px-3 py-2 text-xs border shadow-sm space-y-0.5">
              {routeLoading ? (
                <div className="font-semibold flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Optimizing route…</div>
              ) : (
                <div className="font-semibold">{totalKm} km · ~{etaMin} min</div>
              )}
              <div className="text-muted-foreground">{route.stops.length} stop{route.stops.length === 1 ? "" : "s"}</div>
            </div>

            {showDragHint && route.stops.length > 0 && (
              <div className="absolute top-3 left-3 bg-card/95 rounded-md px-2.5 py-1.5 text-xs border shadow-sm flex items-center gap-1.5 text-muted-foreground">
                <Move className="h-3 w-3" />
                Drag pins to adjust
              </div>
            )}
          </>
        )}
      </div>

      {/* Stop list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
            {type === "logout" ? "Drop sequence" : "Pickup sequence"}
            {editable ? " · drag row or use arrows to reorder" : ""}
          </div>
          {editable && onAdd && (
            <Button size="sm" variant="outline" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" /> Add stop
            </Button>
          )}
        </div>

        {route.stops.length === 0 && (
          <div className="text-sm text-muted-foreground p-6 text-center border-2 border-dashed rounded-md">
            Pick employees to build a route
          </div>
        )}

        {route.stops.map((s, i) => (
          <StopRow
            key={s.empId}
            stop={s}
            idx={i}
            isFirst={i === 0}
            isLast={i === route.stops.length - 1}
            editable={!!editable}
            pickupTime={pickupTimes?.[s.empId] ?? ""}
            onTimeChange={onPickupTimeChange ? (t) => onPickupTimeChange(s.empId, t) : undefined}
            pickupTimeWindow={pickupTimeWindow}
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx !== null && dragIdx !== i && onReorder) onReorder(dragIdx, i);
              setDragIdx(null);
            }}
            onMoveUp={onReorder ? () => onReorder(i, i - 1) : undefined}
            onMoveDown={onReorder ? () => onReorder(i, i + 1) : undefined}
            onRemove={onRemove ? () => onRemove(s.empId) : undefined}
          />
        ))}

        {route.stops.length > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-md border-2 border-foreground bg-foreground/5">
            <div className="h-8 w-8 rounded-md bg-foreground text-background flex items-center justify-center text-xs">★</div>
            <div className="flex-1">
              <div className="font-medium text-sm">{route.drop.name}</div>
              <div className="text-xs text-muted-foreground">{officeLabelText} · Office</div>
            </div>
            <div className="text-xs font-medium">~{etaMin} min total</div>
          </div>
        )}
      </div>
    </div>
  );
}

// Is `hhmm` outside the [min, max] window (min/max are "HH:MM" strings)?
// Handles a window that wraps past midnight (min > max).
function isOutsidePickupWindow(
  hhmm: string | undefined,
  window: { min: string; max: string } | null | undefined,
): boolean {
  if (!hhmm || !window) return false;
  const { min, max } = window;
  if (min <= max) return hhmm < min || hhmm > max;
  return hhmm > max && hhmm < min; // wrapped window — outside is the gap between max and min
}

// ─── Stop row ─────────────────────────────────────────────────────────────────

function StopRow({
  stop, idx, isFirst, isLast, editable, onRemove, onDragStart, onDragOver, onDrop, onMoveUp, onMoveDown, pickupTime, onTimeChange, pickupTimeWindow,
}: {
  stop: RouteStop;
  idx: number;
  isFirst?: boolean;
  isLast?: boolean;
  editable: boolean;
  pickupTime?: string;
  onTimeChange?: (time: string) => void;
  onRemove?: () => void;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  pickupTimeWindow?: { min: string; max: string } | null;
}) {
  const outsideWindow = isOutsidePickupWindow(pickupTime, pickupTimeWindow);
  return (
    <div
      draggable={editable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        "flex items-center gap-3 p-3 rounded-md border bg-card",
        editable && "cursor-move hover:border-gold",
      )}
    >
      {editable && <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />}
      {editable && (onMoveUp || onMoveDown) && (
        <div className="flex flex-col shrink-0 -my-1">
          <Button
            size="icon"
            variant="ghost"
            draggable={false}
            className="h-5 w-5 text-muted-foreground hover:text-gold-dark disabled:opacity-30"
            disabled={isFirst || !onMoveUp}
            onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Move up"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            draggable={false}
            className="h-5 w-5 text-muted-foreground hover:text-gold-dark disabled:opacity-30"
            disabled={isLast || !onMoveDown}
            onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Move down"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="h-8 w-8 rounded-full bg-gold text-gold-foreground flex items-center justify-center text-xs font-bold shrink-0">
        {idx + 1}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          {stop.name}
          {stop.gender === "F" && (
            <Badge variant="outline" className="border-gold/40 bg-gold-soft text-gold-dark text-[10px] py-0">
              Female
            </Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0" /> {stop.location}
        </div>
      </div>
      {/* Pickup time picker — visible only in editable mode */}
      {editable && onTimeChange && (
        <div className="flex flex-col items-end shrink-0 gap-0.5">
          <span className={cn("text-[10px]", outsideWindow ? "text-destructive font-medium" : "text-muted-foreground")}>
            Stop pickup time
          </span>
          <TimeSelect
            value={pickupTime ?? ""}
            onChange={onTimeChange}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            draggable={false}
            min={pickupTimeWindow?.min}
            max={pickupTimeWindow?.max}
            className={cn(
              "h-7 rounded border bg-background px-1.5 text-xs font-mono w-[80px] focus-visible:ring-1",
              outsideWindow
                ? "border-destructive text-destructive focus-visible:ring-destructive"
                : "border-border text-foreground focus-visible:ring-gold",
            )}
          />
          {outsideWindow && pickupTimeWindow && (
            <span className="text-[9px] text-destructive text-right leading-tight max-w-[140px]">
              Should be {pickupTimeWindow.min}–{pickupTimeWindow.max}
            </span>
          )}
        </div>
      )}
      {editable && onRemove && (
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

// ─── Map style ────────────────────────────────────────────────────────────────

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];
