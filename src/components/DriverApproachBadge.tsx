/**
 * DriverApproachBadge
 * Shows on an ASSIGNED ride card (driver accepted, trip not started yet).
 * Displays driver's live distance from the first pickup and a rough ETA.
 * Listens to Socket.io driver:location_update + falls back to polling.
 */

import { useEffect, useRef, useState } from "react";
import { io as ioClient, type Socket } from "socket.io-client";
import { useRideDriverLocation, useRidePax } from "@/lib/queries";
import { tokenStore } from "@/lib/api";
import { Navigation, Loader2 } from "lucide-react";

// ─── Haversine distance (km) ──────────────────────────────────────────────────
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

// Rough ETA assuming 20 km/h average in city traffic
function etaMin(km: number): number {
  return Math.max(1, Math.ceil((km / 20) * 60));
}

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

  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

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

  const distKm  = haversineKm(driverPos.lat, driverPos.lng, firstStop.lat, firstStop.lng);
  const eta     = etaMin(distKm);
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
