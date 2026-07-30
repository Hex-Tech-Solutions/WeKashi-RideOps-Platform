/// <reference types="google.maps" />
/**
 * LiveRideTracker — shown inside the active ride card in supervisor/Live.tsx.
 *
 * Receives real-time driver GPS via Socket.io (driver:location_update).
 * Falls back to polling GET /rides/:id/driver-location every 8 s.
 *
 * Calls Google Directions API client-side to compute per-stop ETAs:
 *   driver → next unvisited pax stops → office
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { io as ioClient, type Socket } from "socket.io-client";
import { useRidePax, useRideDriverLocation } from "@/lib/queries";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { tokenStore } from "@/lib/api";
import { Navigation, Clock, CheckCircle2, Loader2, MapPin } from "lucide-react";

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

  const [driverPos, setDriverPos]   = useState<{ lat: number; lng: number } | null>(null);
  const [stopEtas, setStopEtas]     = useState<StopEta[]>([]);
  const [computing, setComputing]   = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const computeRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Compute ETAs via Google Directions whenever driver position changes
  const computeEtas = useCallback(async (pos: { lat: number; lng: number }) => {
    if (!dropLat || !dropLng) return;
    setComputing(true);
    try {
      const g = await loadGoogleMaps();
      const svc = new g.maps.DirectionsService();

      // Build remaining stops: unvisited pax pickups (login) or drops (logout)
      const remainingStops = isLogin
        ? pax
            .filter((p) => !p.pickedAt && !p.noShow)
            .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, picked: false, isOffice: false }))
        : pax
            .filter((p) => !p.droppedAt && !p.noShow)
            .map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, picked: false, isOffice: false }));

      const officeStop = { name: dropAddress, lat: dropLat, lng: dropLng, picked: false, isOffice: true };
      const allStops = [...remainingStops, officeStop];

      if (allStops.length === 0) { setStopEtas([]); setComputing(false); return; }

      // One Directions request: driver → all remaining stops in order
      const origin      = pos;
      const destination = { lat: allStops[allStops.length - 1].lat, lng: allStops[allStops.length - 1].lng };
      const waypoints   = allStops.slice(0, -1).map((s) => ({ location: { lat: s.lat, lng: s.lng }, stopover: true }));

      svc.route(
        { origin, destination, waypoints, travelMode: g.maps.TravelMode.DRIVING, optimizeWaypoints: false },
        (result, status) => {
          if (status !== "OK" || !result) { setComputing(false); return; }
          const legs = result.routes[0].legs;
          const etas: StopEta[] = legs.map((leg, i) => ({
            name:        allStops[i].name,
            etaMin:      Math.ceil((leg.duration?.value ?? 0) / 60),
            distanceKm:  Math.round((leg.distance?.value ?? 0) / 100) / 10,
            picked:      false,
            isOffice:    allStops[i].isOffice,
          }));
          setStopEtas(etas);
          setComputing(false);
        },
      );
    } catch { setComputing(false); }
  }, [pax, dropLat, dropLng, dropAddress, isLogin]);

  // Debounce ETA compute — max once every 10 s
  useEffect(() => {
    if (!driverPos) return;
    if (computeRef.current) clearTimeout(computeRef.current);
    computeRef.current = setTimeout(() => computeEtas(driverPos), 500);
    return () => { if (computeRef.current) clearTimeout(computeRef.current); };
  }, [driverPos, computeEtas]);

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

  // Cumulative ETA = sum of all leg durations up to that stop
  let cumMin = 0;
  const cumulativeEtas = stopEtas.map((s) => {
    cumMin += s.etaMin ?? 0;
    return { ...s, cumMin };
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
                {i === 0 && !s.isOffice ? "Next pickup — " : s.isOffice ? "Office — " : ""}{s.name}
              </span>
              <span className="shrink-0 flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" />
                {s.cumMin != null ? `~${s.cumMin} min` : "—"}
              </span>
              {s.distanceKm != null && (
                <span className="shrink-0 text-muted-foreground">{s.distanceKm} km</span>
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
