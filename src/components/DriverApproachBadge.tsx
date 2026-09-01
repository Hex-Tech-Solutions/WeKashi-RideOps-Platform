/**
 * DriverApproachBadge
 * Shows on an ASSIGNED ride card (driver accepted, trip not started yet).
 * Displays driver's live distance from the first pickup and a traffic-aware
 * ETA, computed via the backend's Routes API route-matrix endpoint.
 * Listens to Socket.io driver:location_update + falls back to polling.
 */

import { useEffect, useRef, useState } from "react";
import { io as ioClient, type Socket } from "socket.io-client";
import { useRideDriverLocation, useRidePax, useRouteMatrix } from "@/lib/queries";
import { tokenStore } from "@/lib/api";
import { usePageVisibleRef } from "@/hooks/usePageVisible";
import { Navigation, Loader2 } from "lucide-react";

// ─── Haversine distance (km) — used only as an instant placeholder while the
// real (traffic-aware, road-distance) result is in flight. ──────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Throttle real route-matrix calls — driver GPS pings every ~5s but we don't
// need (or want to pay for) a fresh Routes API call that often. Also skipped
// entirely while the browser tab is backgrounded (see usePageVisibleRef).
const REFRESH_MS = 60_000;

// ─── Singleton supervisor socket ──────────────────────────────────────────────
let _sock: Socket | null = null;
function getSock(): Socket {
  if (!_sock || !_sock.connected) {
    _sock = ioClient("/supervisor", {
      auth: { token: tokenStore.access ?? "" },
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
  }
  return _sock;
}

interface Props {
  rideId: string;
}

export function DriverApproachBadge({ rideId }: Props) {
  const { data: initialLoc } = useRideDriverLocation(rideId);
  const { data: paxData }    = useRidePax(rideId);
  const routeMatrix = useRouteMatrix();

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [realDistKm, setRealDistKm] = useState<number | null>(null);
  const [realEtaMin, setRealEtaMin] = useState<number | null>(null);
  const lastFetchAt = useRef(0);
  const isVisibleRef = usePageVisibleRef();

  // Set initial position from REST poll
  useEffect(() => {
    if (initialLoc?.lat != null && initialLoc.lat !== 0) {
      setDriverPos({ lat: initialLoc.lat, lng: initialLoc.lng });
    }
  }, [initialLoc]);

  // Listen for live socket updates
  useEffect(() => {
    const sock = getSock();
    const handler = (data: { rideId: string; lat: number; lng: number }) => {
      if (data.rideId !== rideId) return;
      setDriverPos({ lat: data.lat, lng: data.lng });
      setLastUpdate(new Date());
    };
    sock.on("driver:location_update", handler);
    return () => { sock.off("driver:location_update", handler); };
  }, [rideId]);

  // Find first unvisited pax pickup
  const pax = paxData?.pax ?? [];
  const firstStop = pax.find((p) => !p.pickedAt && !p.noShow);

  // Throttled real distance/ETA via backend Routes API (traffic-aware, real roads).
  // Skipped while the browser tab is backgrounded — no API call happens if
  // nobody has this page in the foreground.
  useEffect(() => {
    if (!driverPos || !firstStop) return;
    if (!isVisibleRef.current) return;
    const now = Date.now();
    if (now - lastFetchAt.current < REFRESH_MS) return;
    lastFetchAt.current = now;

    routeMatrix.mutate(
      {
        origins: [{ lat: driverPos.lat, lng: driverPos.lng }],
        destinations: [{ lat: firstStop.lat, lng: firstStop.lng }],
      },
      {
        onSuccess: (res) => {
          const el = res.elements[0];
          if (el?.routeExists && el.distanceMeters != null && el.durationSeconds != null) {
            setRealDistKm(Math.round((el.distanceMeters / 1000) * 10) / 10);
            setRealEtaMin(Math.max(1, Math.round(el.durationSeconds / 60)));
          }
        },
        // Silently keep the Haversine placeholder if the call fails.
        onError: () => {},
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPos?.lat, driverPos?.lng, firstStop?.lat, firstStop?.lng]);

  if (!driverPos) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for driver location…
      </div>
    );
  }

  if (!firstStop) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Navigation className="h-3 w-3" />
        All stops visited
      </div>
    );
  }

  // Prefer the real (traffic-aware) result; fall back to Haversine placeholder
  // instantly on every GPS ping so the badge never looks frozen while waiting.
  const haversine = haversineKm(driverPos.lat, driverPos.lng, firstStop.lat, firstStop.lng);
  const distKm = realDistKm ?? haversine;
  const eta    = realEtaMin ?? Math.max(1, Math.ceil((haversine / 20) * 60));
  const display = distKm < 1 ? `${Math.round(distKm * 1000)} m` : `${distKm.toFixed(1)} km`;

  // Colour code by proximity
  const colour =
    distKm < 0.5  ? "text-success"  :   // < 500 m — almost there
    distKm < 2    ? "text-gold-dark" :   // < 2 km  — close
                    "text-muted-foreground"; // further away

  return (
    <div className={`flex items-center justify-between text-xs ${colour}`}>
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse shrink-0" />
        Driver is <span className="font-semibold">{display} away</span>
        {" "}· ETA ~{eta} min to first pickup
      </span>
      {lastUpdate && (
        <span className="text-muted-foreground text-[10px] shrink-0">
          {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
    </div>
  );
}
