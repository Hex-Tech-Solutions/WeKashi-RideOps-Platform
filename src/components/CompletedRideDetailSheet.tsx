/// <reference types="google.maps" />
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRideDetail, type RideDetail, type RidePassenger } from "@/lib/queries";
import { loadGoogleMaps } from "@/lib/googleMaps";
import {
  Loader2,
  MapPin,
  User,
  Car,
  Users,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Star,
  Route,
  IndianRupee,
  CalendarClock,
  Clock,
  Building2,
} from "lucide-react";
import { format, formatDistanceStrict } from "date-fns";

interface Props {
  rideId: string | undefined;
  onClose: () => void;
}

// ─── Map styles ───────────────────────────────────────────────────────────────

const mapStyle: google.maps.MapTypeStyle[] = [
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

// ─── Main component ───────────────────────────────────────────────────────────

export function CompletedRideDetailSheet({ rideId, onClose }: Props) {
  const { data: ride, isLoading, isError } = useRideDetail(rideId);

  return (
    <Sheet open={!!rideId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="bottom"
        className="h-[92vh] p-0 flex flex-col rounded-t-2xl overflow-hidden"
      >
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <SheetTitle className="text-sm flex items-center gap-2">
            <Route className="h-4 w-4 text-gold" />
            Ride Detail
            {ride && (
              <span className="font-mono text-xs text-muted-foreground ml-1">
                #{ride.id.slice(-8).toUpperCase()}
              </span>
            )}
            {ride && (
              <Badge
                variant="outline"
                className="ml-auto capitalize text-[10px] py-0 border-success/40 text-success"
              >
                {ride.status.replace("_", " ")}
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {isError && (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive px-6 text-center">
            Could not load ride details. Please try again.
          </div>
        )}

        {ride && (
          <ScrollArea className="flex-1">
            <div className="px-4 py-4 space-y-5 pb-10">

              {/* ── Route map ─────────────────────────────────────────── */}
              <TrailMap ride={ride} />

              {/* ── Ride metadata ──────────────────────────────────────── */}
              <Section title="Trip Summary" icon={<Route className="h-3.5 w-3.5" />}>
                <InfoGrid>
                  <InfoRow label="Type" value={<span className="capitalize">{ride.type}</span>} />
                  <InfoRow label="Vehicle" value={ride.vehicleType ?? "—"} />
                  {ride.distanceKm != null && (
                    <InfoRow label="Distance" value={`${ride.distanceKm} km`} />
                  )}
                  {ride.price != null && (
                    <InfoRow
                      label="Fare"
                      value={
                        <span className="flex items-center gap-0.5 font-semibold">
                          <IndianRupee className="h-3 w-3" />{ride.price}
                        </span>
                      }
                    />
                  )}
                  <InfoRow
                    label="Created"
                    value={format(new Date(ride.createdAt), "dd MMM yyyy, HH:mm")}
                  />
                  {ride.acceptedAt && (
                    <InfoRow
                      label="Accepted"
                      value={format(new Date(ride.acceptedAt), "dd MMM yyyy, HH:mm")}
                    />
                  )}
                  {ride.driverReportingTime && (
                    <InfoRow
                      label="Driver arrived"
                      value={format(new Date(ride.driverReportingTime), "dd MMM yyyy, HH:mm")}
                    />
                  )}
                  {ride.plannedStartTime && (
                    <InfoRow
                      label="Planned pickup"
                      value={format(new Date(ride.plannedStartTime), "HH:mm")}
                    />
                  )}
                  {ride.startedAt && (
                    <InfoRow
                      label="Started"
                      value={format(new Date(ride.startedAt), "dd MMM yyyy, HH:mm")}
                    />
                  )}
                  {ride.completedAt && (
                    <InfoRow
                      label="Completed"
                      value={format(new Date(ride.completedAt), "dd MMM yyyy, HH:mm")}
                    />
                  )}
                  {ride.completedAt && ride.startedAt && (
                    <InfoRow
                      label="Trip duration"
                      value={formatDistanceStrict(
                        new Date(ride.completedAt),
                        new Date(ride.startedAt),
                      )}
                    />
                  )}
                  {ride.completedAt && ride.createdAt && (
                    <InfoRow
                      label="Total time"
                      value={formatDistanceStrict(
                        new Date(ride.completedAt),
                        new Date(ride.createdAt),
                      )}
                    />
                  )}
                  {ride.scheduledFor && (
                    <InfoRow
                      label="Scheduled for"
                      value={format(new Date(ride.scheduledFor), "dd MMM yyyy, HH:mm")}
                    />
                  )}
                </InfoGrid>

                {/* Pickup / drop address pills */}
                <div className="mt-3 space-y-2">
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pickup</div>
                      <div className="font-medium">{ride.pickupAddress}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Drop</div>
                      <div className="font-medium">{ride.dropAddress}</div>
                    </div>
                  </div>
                </div>
              </Section>

              <Separator />

              {/* ── Driver ─────────────────────────────────────────────── */}
              <Section title="Driver" icon={<Car className="h-3.5 w-3.5" />}>
                {ride.driver ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-foreground text-background flex items-center justify-center font-bold text-sm shrink-0">
                        {ride.driver.fullName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{ride.driver.fullName}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 text-gold fill-gold" />
                          {ride.driver.rating.toFixed(1)}
                          {ride.driver.vehicleType && (
                            <span className="capitalize">· {ride.driver.vehicleType}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {ride.driver.vehicle && (
                      <InfoGrid>
                        <InfoRow label="Reg. No." value={ride.driver.vehicle.regNo} />
                        <InfoRow label="Capacity" value={`${ride.driver.vehicle.capacity} seats`} />
                        <InfoRow label="Fuel" value={ride.driver.vehicle.fuelType} />
                      </InfoGrid>
                    )}

                    {ride.vendor && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        Vendor: <span className="font-medium text-foreground">{ride.vendor.name}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No driver assigned.</div>
                )}
              </Section>

              <Separator />

              {/* ── Passengers ─────────────────────────────────────────── */}
              <Section
                title={`Passengers (${ride.passengers.length})`}
                icon={<Users className="h-3.5 w-3.5" />}
              >
                {ride.passengers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No passenger records.</div>
                ) : (
                  <div className="space-y-2">
                    {ride.passengers.map((p) => (
                      <PaxCard key={p.empId} pax={p} rideType={ride.type} />
                    ))}
                  </div>
                )}
              </Section>

              <Separator />

              {/* ── Supervisor ─────────────────────────────────────────── */}
              {ride.supervisor && (
                <Section title="Supervisor" icon={<User className="h-3.5 w-3.5" />}>
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-secondary text-foreground flex items-center justify-center font-bold text-sm shrink-0">
                      {ride.supervisor.fullName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{ride.supervisor.fullName}</div>
                      <div className="text-xs text-muted-foreground">
                        {ride.supervisor.org ?? ride.supervisor.email}
                      </div>
                    </div>
                  </div>
                </Section>
              )}

            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Google Maps trail renderer ───────────────────────────────────────────────

function TrailMap({ ride }: { ride: RideDetail }) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Boot map once
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapEl.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: { lat: 12.9716, lng: 77.5946 },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          styles: mapStyle,
        });
        setReady(true);
      })
      .catch((e) => setMapError(e.message));
    return () => { cancelled = true; };
  }, []);

  // Draw trail + markers whenever map is ready or ride changes
  useEffect(() => {
    if (!ready || !mapRef.current || !ride) return;
    const g = (window as any).google as typeof google;
    const map = mapRef.current;
    const bounds = new g.maps.LatLngBounds();

    // ── Pickup marker (green)
    if (ride.pickupLat != null && ride.pickupLng != null) {
      bounds.extend({ lat: ride.pickupLat, lng: ride.pickupLng });
      new g.maps.Marker({
        map,
        position: { lat: ride.pickupLat, lng: ride.pickupLng },
        title: `Pickup: ${ride.pickupAddress}`,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#22c55e",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        label: { text: "S", color: "#fff", fontSize: "10px", fontWeight: "700" },
      });
    }

    // ── Drop marker (gold)
    if (ride.dropLat != null && ride.dropLng != null) {
      bounds.extend({ lat: ride.dropLat, lng: ride.dropLng });
      new g.maps.Marker({
        map,
        position: { lat: ride.dropLat, lng: ride.dropLng },
        title: `Drop: ${ride.dropAddress}`,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#D4AF37",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        label: { text: "E", color: "#111", fontSize: "10px", fontWeight: "700" },
      });
    }

    // ── Passenger pickup pins (numbered, muted)
    ride.passengers.forEach((p, i) => {
      // We don't store per-pax lat/lng in the detail response but the
      // trail already visualises the actual path. Skip individual pins.
      void p; void i;
    });

    // ── GPS breadcrumb polyline — BLUE = actual route driven by driver
    if (ride.locationTrail.length >= 2) {
      const path = ride.locationTrail.map((pt) => ({ lat: pt.lat, lng: pt.lng }));
      path.forEach((pt) => bounds.extend(pt));

      new g.maps.Polyline({
        map,
        path,
        strokeColor: "#3b82f6",   // blue — actual route
        strokeWeight: 5,
        strokeOpacity: 0.9,
        icons: [
          {
            icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#fff" },
            repeat: "80px",
          },
        ],
      });

      // Start dot
      new g.maps.Marker({
        map,
        position: path[0],
        title: "Trip started here",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#22c55e",
          fillOpacity: 0.8,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      });

      // End dot
      new g.maps.Marker({
        map,
        position: path[path.length - 1],
        title: "Trip ended here",
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#ef4444",
          fillOpacity: 0.8,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      });
    }

    // ── Suggested route — GOLD via Directions API (always drawn)
    // Shown alongside the GPS trail so supervisor can compare both.
    if (ride.pickupLat != null && ride.dropLat != null) {
      const directionsService = new g.maps.DirectionsService();
      directionsService.route(
        {
          origin:      { lat: ride.pickupLat, lng: ride.pickupLng! },
          destination: { lat: ride.dropLat,   lng: ride.dropLng! },
          travelMode:  g.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === "OK" && result) {
            const suggestedPath: google.maps.LatLng[] = [];
            result.routes[0].legs.forEach((leg) =>
              leg.steps.forEach((step) => step.path.forEach((p) => suggestedPath.push(p)))
            );
            new g.maps.Polyline({
              map,
              path: suggestedPath,
              strokeColor: "#D4AF37",  // gold — suggested route
              strokeWeight: ride.locationTrail.length >= 2 ? 3 : 4, // thinner when GPS trail is also shown
              strokeOpacity: ride.locationTrail.length >= 2 ? 0.6 : 0.85,
              icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
              zIndex: 1, // behind the blue GPS trail
            });
            // Only re-fit to route bounds when there's no GPS trail
            if (ride.locationTrail.length < 2) {
              const routeBounds = new g.maps.LatLngBounds();
              suggestedPath.forEach((p) => routeBounds.extend(p));
              map.fitBounds(routeBounds, 60);
            }
          } else if (ride.locationTrail.length < 2) {
            // Directions failed and no GPS trail — straight dashed line as last resort
            new g.maps.Polyline({
              map,
              path: [
                { lat: ride.pickupLat!, lng: ride.pickupLng! },
                { lat: ride.dropLat!,   lng: ride.dropLng! },
              ],
              strokeColor: "#D4AF37",
              strokeWeight: 3,
              strokeOpacity: 0.5,
              icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
            });
          }
        },
      );
    }

    if (!bounds.isEmpty()) map.fitBounds(bounds, 60);
  }, [ready, ride]);

  const hasTrail = (ride?.locationTrail?.length ?? 0) >= 2;

  return (
    <div className="relative rounded-lg border overflow-hidden bg-muted" style={{ height: 240 }}>
      <div ref={mapEl} className="absolute inset-0" />

      {!ready && !mapError && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
        </div>
      )}
      {mapError && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-destructive p-6 text-center">
          Map unavailable · Set VITE_GOOGLE_MAPS_KEY to enable
        </div>
      )}

      {ready && (
        <div className="absolute bottom-2 left-2 bg-card/95 border shadow-sm rounded-md px-2.5 py-1.5 text-[10px] flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-success" /> Start
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-gold" /> End
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-4 rounded-sm bg-gold opacity-70" />
            <span className="text-muted-foreground">Suggested</span>
          </span>
          {hasTrail && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-4 rounded-sm bg-blue-500" />
              <span className="text-blue-500 font-medium">Actual</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Passenger card ───────────────────────────────────────────────────────────

function PaxCard({
  pax,
  rideType,
}: {
  pax: RidePassenger;
  rideType: string;
}) {
  const isLogin = rideType !== "logout";
  const status = pax.noShow
    ? "no-show"
    : pax.droppedAt
    ? "completed"
    : pax.pickedAt
    ? "in-transit"
    : "not-picked";

  const statusConfig = {
    "completed":   { icon: <CheckCircle2 className="h-4 w-4 text-success" />, label: "Completed",   cls: "border-success/30 bg-success/5" },
    "in-transit":  { icon: <Clock className="h-4 w-4 text-gold" />,           label: "In transit",  cls: "border-gold/30 bg-gold/5" },
    "no-show":     { icon: <XCircle className="h-4 w-4 text-destructive" />,  label: "No-show",     cls: "border-destructive/30 bg-destructive/5" },
    "not-picked":  { icon: <MinusCircle className="h-4 w-4 text-muted-foreground" />, label: "Not picked", cls: "border-border" },
  }[status];

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${statusConfig.cls}`}>
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold shrink-0">
          {pax.seq + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm flex items-center gap-2">
            {pax.name}
            {pax.gender?.toLowerCase().startsWith("f") && (
              <Badge variant="outline" className="border-gold/40 bg-gold/5 text-gold-dark text-[10px] py-0">F</Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{pax.empId}</div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {statusConfig.icon}
          <span className="text-xs font-medium">{statusConfig.label}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground pl-9">
        {isLogin && (
          <div className="flex items-start gap-1">
            <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-success" />
            <span className="truncate">{pax.pickupAddress}</span>
          </div>
        )}
        <div className="flex items-start gap-1">
          <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-gold" />
          <span className="truncate">{pax.dropAddress}</span>
        </div>
      </div>

      {(pax.pickedAt || pax.droppedAt) && (
        <div className="flex gap-4 text-[10px] text-muted-foreground pl-9">
          {pax.pickedAt && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Picked {format(new Date(pax.pickedAt), "HH:mm")}
            </span>
          )}
          {pax.droppedAt && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              Dropped {format(new Date(pax.droppedAt), "HH:mm")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">{children}</div>;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </>
  );
}
