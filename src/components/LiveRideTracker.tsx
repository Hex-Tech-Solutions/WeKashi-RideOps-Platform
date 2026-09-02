/**
 * LiveRideTracker — shown inside the active ride card in supervisor/Live.tsx.
 * Only rendered while status === "in_progress" (see Live.tsx).
 *
 * Receives real-time driver GPS via Socket.io (driver:location_update) for
 * the position DISPLAY, updated as often as pings arrive (no API cost — pure
 * socket data). Falls back to polling GET /rides/:id/driver-location every 8s.
 *
 * Calls the backend's Routes API proxy (POST /routing/route) to compute
 * per-stop ETAs: driver -> next unvisited pax stops -> office, in the FIXED
 * pax order (never re-optimized — the driver is physically following that
 * sequence already). This is the BILLABLE part, so it's throttled to once
 * per ETA_REFRESH_MS (60s) regardless of GPS ping frequency, and skipped
 * entirely while the browser tab is backgrounded (unmounting Live.tsx or
 * switching tabs stops it completely).
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io as ioClient, type Socket } from "socket.io-client";
import { useRidePax, useRideDriverLocation, useComputeRoute } from "@/lib/queries";
import { tokenStore } from "@/lib/api";
import { usePageVisibleRef } from "@/hooks/usePageVisible";
import { Navigation, Clock, CheckCircle2, Loader2, MapPin } from "lucide-react";

// Real Routes API call happens at most once per this interval, no matter how
// often the driver's GPS position updates (which is every ~5s via socket).
// Skipped entirely while the browser tab is backgrounded.
const ETA_REFRESH_MS = 60_000;

// Singleton supervisor socket — created once, shared across all tracker instances
let supervisorSocket: Socket | null = null;
function getSupervisorSocket(): Socket {
  if (!supervisorSocket || !supervisorSocket.connected) {
    supervisorSocket = ioClient("/supervisor", {
      auth: { token: tokenStore.access ?? "" },
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
  }
  return supervisorSocket;
}

interface StopEta {
  name: string;
  etaMin: number | null;
  distanceKm: number | null;
  picked: boolean;
  isOffice: boolean;
}

interface Props {
  rideId: string;
  rideType: string;
  dropAddress: string;
  dropLat: number | null | undefined;
  dropLng: number | null | undefined;
}

export function LiveRideTracker({ rideId, rideType, dropAddress, dropLat, dropLng }: Props) {
  const { data: paxData } = useRidePax(rideId);
  const { data: initialLoc } = useRideDriverLocation(rideId);
  const computeRoute = useComputeRoute();

  const [driverPos, setDriverPos]   = useState<{ lat: number; lng: number } | null>(null);
  const [stopEtas, setStopEtas]     = useState<StopEta[]>([]);
  const [computing, setComputing]   = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const latestDriverPosRef          = useRef<{ lat: number; lng: number } | null>(null);
  const isVisibleRef                = usePageVisibleRef();

  const pax = paxData?.pax ?? [];
  const isLogin = rideType !== "logout";

  // Set initial position from REST poll
  useEffect(() => {
    if (initialLoc?.lat != null && initialLoc.lat !== 0) {
      setDriverPos({ lat: initialLoc.lat, lng: initialLoc.lng });
    }
  }, [initialLoc]);

  // Subscribe to Socket.io live updates
  useEffect(() => {
    const sock = getSupervisorSocket();
    const handler = (data: { rideId: string; lat: number; lng: number }) => {
      if (data.rideId !== rideId) return;
      setDriverPos({ lat: data.lat, lng: data.lng });
      setLastUpdate(new Date());
    };
    sock.on("driver:location_update", handler);
    return () => { sock.off("driver:location_update", handler); };
  }, [rideId]);

  // Compute ETAs via the backend's Routes API proxy whenever driver position changes
  const computeEtas = useCallback((pos: { lat: number; lng: number }) => {
    // Only login rides need the ride-level drop point (the office) as a final
    // stop; logout rides end at the last employee's home, which is already in
    // the pax list.
    if (isLogin && (dropLat == null || dropLng == null)) return;

    // Build the remaining stop sequence from the driver's current position.
    //
    // Login: each unvisited employee's home, then the office as the final
    // destination (ride.dropPoint IS the office for login rides).
    //
    // Logout: each employee still to be dropped, in order. The final stop is
    // simply the last of those homes — do NOT append ride.dropPoint, because
    // for a logout ride that IS the last employee's home (see createRide:
    // dropPoint = pt(last.point)), so appending it duplicated the last stop and
    // mislabelled it "Office".
    const remainingStops = isLogin
      ? pax
          .filter((p) => !p.pickedAt && !p.noShow)
          .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, isOffice: false }))
      : pax
          .filter((p) => !p.droppedAt && !p.noShow)
          .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, isOffice: false }));

    const allStops = isLogin && dropLat != null && dropLng != null
      ? [...remainingStops, { name: dropAddress, lat: dropLat, lng: dropLng, isOffice: true }]
      : remainingStops;
    if (allStops.length === 0) { setStopEtas([]); return; }

    setComputing(true);
    const destination = { lat: allStops[allStops.length - 1].lat, lng: allStops[allStops.length - 1].lng };
    const intermediates = allStops.slice(0, -1).map((s) => ({ lat: s.lat, lng: s.lng }));

    computeRoute.mutate(
      { origin: pos, destination, intermediates },
      {
        onSuccess: (result) => {
          const etas: StopEta[] = result.legs.map((leg, i) => ({
            name:       allStops[i].name,
            etaMin:     Math.ceil(leg.durationSeconds / 60),
            distanceKm: Math.round((leg.distanceMeters / 100)) / 10,
            picked:     false,
            isOffice:   allStops[i].isOffice,
          }));
          setStopEtas(etas);
          setComputing(false);
        },
        onError: () => setComputing(false),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pax, dropLat, dropLng, dropAddress, isLogin]);

  // Track the latest driver position for the interval tick to read, without
  // re-creating the interval every time a new GPS ping arrives.
  useEffect(() => { latestDriverPosRef.current = driverPos; }, [driverPos]);

  // Recompute ETAs on a fixed interval (not on every GPS ping) — this is the
  // actual cost control. The driver's position updates every ~5s via socket,
  // but a real Routes API call only fires once per ETA_REFRESH_MS, and is
  // skipped entirely while the browser tab is backgrounded.
  useEffect(() => {
    if (!driverPos) return;
    // Compute once immediately so the tracker isn't empty on first mount.
    computeEtas(driverPos);
    const interval = setInterval(() => {
      if (!isVisibleRef.current) return; // tab backgrounded — skip this tick, no API call
      const pos = latestDriverPosRef.current;
      if (pos) computeEtas(pos);
    }, ETA_REFRESH_MS);
    return () => clearInterval(interval);
    // Only (re)start the interval when we first get a driver position or the
    // callback identity changes (stops/office change) — NOT on every ping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!driverPos, computeEtas]);

  // Picked-up pax for already boarded section
  const pickedPax = pax.filter((p) => p.pickedAt && !p.droppedAt && !p.noShow);
  const droppedCount = pax.filter((p) => p.droppedAt).length;

  if (!driverPos && stopEtas.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Waiting for driver GPS signal…
      </div>
    );
  }

  // Running totals from the driver's current position, so each row answers
  // "how far / how long until this stop" rather than mixing a cumulative time
  // with a single-leg distance.
  let cumMin = 0;
  let cumKm = 0;
  const cumulativeEtas = stopEtas.map((s) => {
    cumMin += s.etaMin ?? 0;
    cumKm += s.distanceKm ?? 0;
    return { ...s, cumMin, cumKm: Math.round(cumKm * 10) / 10 };
  });

  return (
    <div className="space-y-2">
      {/* Driver position indicator */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          Driver GPS live
        </span>
        {lastUpdate && (
          <span>Updated {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
        )}
        {computing && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>

      {/* On board */}
      {pickedPax.length > 0 && (
        <div className="rounded-md bg-success/5 border border-success/20 px-2.5 py-1.5 text-xs text-success flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          On board: {pickedPax.map((p) => p.name.split(" ")[0]).join(", ")}
        </div>
      )}

      {/* ETA list */}
      {cumulativeEtas.length > 0 && (
        <div className="space-y-1">
          {cumulativeEtas.map((s, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 text-xs py-1.5 px-2.5 rounded-md ${
                s.isOffice ? "bg-foreground/5 border border-foreground/10" : "bg-muted/40"
              }`}
            >
              {s.isOffice
                ? <MapPin className="h-3.5 w-3.5 shrink-0 text-foreground" />
                : <Navigation className="h-3.5 w-3.5 shrink-0 text-gold" />
              }
              <span className={`flex-1 truncate font-medium ${s.isOffice ? "text-foreground" : "text-foreground/80"}`}>
                {i === 0 && !s.isOffice
                  ? (isLogin ? "Next pickup — " : "Next drop — ")
                  : s.isOffice ? "Office — " : ""}{s.name}
              </span>
              {/* Both figures are cumulative from the driver's current position,
                  so they read consistently down the list. Showing a cumulative
                  ETA next to a per-leg distance made a later stop look nearer
                  than an earlier one (e.g. "~48 min · 3 km" after "~40 min ·
                  13.2 km"), which is exactly backwards. */}
              <span className="shrink-0 flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {s.cumMin != null ? `~${s.cumMin} min` : "—"}
              </span>
              {s.cumKm != null && (
                <span className="shrink-0 text-muted-foreground">{s.cumKm} km</span>
              )}
            </div>
          ))}
        </div>
      )}

      {droppedCount > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {droppedCount} passenger{droppedCount === 1 ? "" : "s"} dropped off
        </div>
      )}
    </div>
  );
}
