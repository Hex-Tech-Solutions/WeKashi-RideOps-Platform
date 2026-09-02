import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useDriverMe, useDriverOffers, useDriverRides,
  useGoOnline, useGoOffline, useUpdateDriverLocation, useAcceptOffer, useRejectOffer, useAdvanceRideStatus,
  useRide, useMarkDriverArrived, useRouteMatrix, useDriverCancelRide,
  type RideRow,
} from "@/lib/queries";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MapPin, Users, IndianRupee, Check, X, LocateFixed, ChevronRight, ChevronsRight, Shield, Navigation, Timer } from "lucide-react";
import { toast } from "sonner";
import DriverTrip from "./DriverTrip";
import DriverBoarding from "./DriverBoarding";
import { DriverOfferCard, type ApproachInfo } from "./DriverOfferCard";

/**
 * How long a driver→pickup distance stays fresh. Offers refresh every 8s; without
 * this the batched matrix call would fire on every one of those polls.
 */
const APPROACH_TTL_MS = 120_000;
import { getDevicePosition, watchDevicePosition } from "@/lib/deviceLocation";
import { CompletedRideDetailSheet } from "@/components/CompletedRideDetailSheet";
import { mapsUrl, mapsUrlForAddress } from "@/lib/queries";

export default function DriverHome() {
  const { data: me } = useDriverMe();
  const { data: offersData } = useDriverOffers();
  const { data: ridesData } = useDriverRides();
  const goOnline = useGoOnline();
  const goOffline = useGoOffline();
  const updateLocation = useUpdateDriverLocation();
  const accept = useAcceptOffer();
  const reject = useRejectOffer();
  const advance = useAdvanceRideStatus();
  const markArrived = useMarkDriverArrived();

  const online = me?.isOnline ?? false;
  const offers = offersData?.offers ?? [];
  const rides = ridesData?.rides ?? [];
  const active = rides.find((r) => r.status === "assigned" || r.status === "in_progress");
  const history = rides.filter((r) => ["completed", "cancelled"].includes(r.status)).slice(0, 8);

  // Gate: all boarded passengers must have their drop OTP verified before
  // the driver can complete the trip. Starts as false; DriverTrip reports up.
  const [allDropsDone, setAllDropsDone] = useState(false);

  // Gate: on logout rides every employee must be boarding-verified (or marked
  // no-show) at the office before the trip can start. DriverBoarding reports up.
  const [allBoarded, setAllBoarded] = useState(false);

  // Track which assigned rides the driver has already confirmed arrival for
  const [arrivedRideIds, setArrivedRideIds] = useState<Set<string>>(new Set());

  // Completed-ride detail sheet
  const [detailRideId, setDetailRideId] = useState<string | undefined>(undefined);

  // "Can't take this ride" dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const driverCancel = useDriverCancelRide();

  // Fetch full ride detail for the active ride so we have drop lat/lng.
  const { data: activeRideFull } = useRide(active?.id);

  // ── Driver → pickup distance for every offer, in ONE API call ──────────────
  // computeRouteMatrix takes one origin (the driver) and many destinations (each
  // offer's pickup), so the whole list costs a single billable request rather
  // than one per card. Recomputed only when the set of offers changes, and at
  // most once per APPROACH_TTL_MS — a driver idling in one place while offers
  // refresh every 8s must not trigger a call each time.
  const [approaches, setApproaches] = useState<Record<string, ApproachInfo>>({});
  const routeMatrix = useRouteMatrix();
  const lastApproachAt = useRef(0);
  const lastOfferKey = useRef("");

  const offerKey = offers.map((o) => o.id).sort().join(",");

  useEffect(() => {
    if (!online || offers.length === 0) return;

    const withCoords = offers.filter((o) => o.pickupLat != null && o.pickupLng != null);
    if (withCoords.length === 0) return;

    // Skip if neither the offer set nor the TTL warrants a refresh.
    const now = Date.now();
    const offersChanged = offerKey !== lastOfferKey.current;
    if (!offersChanged && now - lastApproachAt.current < APPROACH_TTL_MS) return;

    let cancelled = false;
    getDevicePosition()
      .then((pos) => {
        if (cancelled) return;
        lastApproachAt.current = Date.now();
        lastOfferKey.current = offerKey;

        routeMatrix.mutate(
          {
            origins: [{ lat: pos.lat, lng: pos.lng }],
            destinations: withCoords.map((o) => ({ lat: o.pickupLat!, lng: o.pickupLng! })),
          },
          {
            onSuccess: (res) => {
              if (cancelled) return;
              const next: Record<string, ApproachInfo> = {};
              res.elements.forEach((el) => {
                // destinationIndex maps back to withCoords order.
                const ride = withCoords[el.destinationIndex ?? 0];
                if (!ride) return;
                next[ride.id] = {
                  km: el.distanceMeters != null ? Math.round((el.distanceMeters / 1000) * 10) / 10 : null,
                  min: el.durationSeconds != null ? Math.max(1, Math.round(el.durationSeconds / 60)) : null,
                };
              });
              setApproaches((prev) => ({ ...prev, ...next }));
            },
            // Leave the cards showing "—" rather than a wrong number.
            onError: () => {},
          },
        );
      })
      .catch(() => {/* no GPS permission — cards just show "—" */});

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, offerKey]);

  // While online, watch the device GPS and push live location to the server.
  useEffect(() => {
    if (!online) return;
    const stop = watchDevicePosition((c) => updateLocation.mutate(c));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // Logout rides board everyone at the office up front, so departure is gated
  // on boarding verification. Login rides pick up employee-by-employee during
  // the trip, so there's nothing to verify before starting.
  const isLogoutRide = (ride: RideRow) => ride.type === "logout";

  const canStartTrip = (ride: RideRow) => {
    if (!isLogoutRide(ride)) return true;
    // Must be at the office and have everyone accounted for before departing.
    return arrivedRideIds.has(ride.id) && allBoarded;
  };

  const startBlockedReason = (ride: RideRow) => {
    if (!arrivedRideIds.has(ride.id)) return "Confirm arrival at the office first.";
    return "Verify every employee's boarding OTP (or mark them no-show) before starting.";
  };

  const toggleOnline = async (on: boolean) => {
    if (on) {
      try {
        const loc = await getDevicePosition();
        goOnline.mutate(loc, {
          onSuccess: () => toast.success("You're online — live location shared"),
          onError: (e: any) => toast.error(e?.message ?? "Failed"),
        });
      } catch (e: any) {
        toast.error(e?.message ?? "Could not get your location");
      }
    } else {
      goOffline.mutate(undefined, { onSuccess: () => toast.success("You're offline"), onError: (e: any) => toast.error(e?.message ?? "Failed") });
    }
  };

  return (
    <div>
      <div>
        {/* Online toggle */}
        <div className="p-4">
          <Card className={online ? "border-success/50 bg-success/5" : ""}>
            <CardContent className="p-4 flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
              <div className="flex-1">
                <div className="font-medium text-sm">{online ? "You're online" : "You're offline"}</div>
                <div className="text-xs text-muted-foreground">{online ? "Receiving ride broadcasts" : "Go online to receive rides"}</div>
              </div>
              <Switch checked={online} onCheckedChange={toggleOnline} disabled={goOnline.isPending || goOffline.isPending} />
            </CardContent>
          </Card>
          {!online ? (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <LocateFixed className="h-3.5 w-3.5" /> Flip the switch — we'll use your device GPS to go online.
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 text-[11px] text-success">
              <LocateFixed className="h-3.5 w-3.5" /> Live location is being shared.
            </div>
          )}
        </div>

        {/* Active ride */}
        {active && (
          <div className="px-4 pb-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Active ride</div>
            <Card className="border-gold/50">
              <CardContent className="p-4 space-y-3">
                <RideSummary ride={active} />
                {active.status === "assigned" ? (
                  <div className="space-y-3">
                    {/* Navigate to pickup — office for logout, first employee's
                        home for login. Always rendered while the driver hasn't
                        confirmed arrival: prefers exact PostGIS coords, falls
                        back to the pickup address so the link never vanishes
                        just because the ride-detail request hasn't resolved. */}
                    {!arrivedRideIds.has(active.id) && (
                      <a
                        href={
                          activeRideFull?.pickupLat != null && activeRideFull?.pickupLng != null
                            ? mapsUrl(activeRideFull.pickupLat, activeRideFull.pickupLng)
                            : mapsUrlForAddress(active.pickupAddress)
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
                      >
                        <Navigation className="h-4 w-4" />
                        Navigate to pickup — open maps
                      </a>
                    )}
                    {/* Arrived slider — shown until driver confirms */}
                    {!arrivedRideIds.has(active.id) && (
                      <ArrivedSlider
                        isPending={markArrived.isPending}
                        onArrived={() => {
                          markArrived.mutate(active.id, {
                            onSuccess: () => {
                              setArrivedRideIds((s) => new Set(s).add(active.id));
                              toast.success("Arrival confirmed — start collecting passengers");
                            },
                            onError: (e: any) => toast.error(e?.message ?? "Failed"),
                          });
                        }}
                      />
                    )}
                    {arrivedRideIds.has(active.id) && (
                      <div className="flex items-center justify-center gap-2 text-xs text-success py-1">
                        <Check className="h-3.5 w-3.5" /> Arrival confirmed at pickup location
                      </div>
                    )}

                    {/* Logout rides: employees board together at the office, so
                        boarding is verified HERE — before departure — not after
                        Start trip. Only shown once the driver confirms arrival,
                        since there's nobody to board until the cab is there. */}
                    {isLogoutRide(active) && arrivedRideIds.has(active.id) && (
                      <DriverBoarding rideId={active.id} onAllBoarded={setAllBoarded} />
                    )}

                    <Button
                      className="w-full bg-gold text-gold-foreground hover:bg-gold/90 disabled:opacity-50"
                      disabled={advance.isPending || !canStartTrip(active)}
                      title={!canStartTrip(active) ? startBlockedReason(active) : undefined}
                      onClick={() => advance.mutate({ id: active.id, status: "in_progress" }, { onSuccess: () => toast.success("Trip started"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}
                    >
                      Start trip
                    </Button>
                    {!canStartTrip(active) && (
                      <p className="text-[11px] text-muted-foreground text-center -mt-1">
                        {startBlockedReason(active)}
                      </p>
                    )}

                    {/* Can't do this ride — hands it back so another driver can
                        take it, rather than the driver simply not turning up. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground hover:text-destructive"
                      onClick={() => { setCancelReason(""); setCancelOpen(true); }}
                    >
                      <X className="h-3.5 w-3.5" /> Can't take this ride
                    </Button>
                  </div>
                ) : (
                  <>
                    <DriverTrip
                      rideId={active.id}
                      rideType={active.type}
                      dropAddress={activeRideFull?.dropAddress ?? active.dropAddress}
                      dropLat={activeRideFull?.dropLat}
                      dropLng={activeRideFull?.dropLng}
                      onAllDropsDone={setAllDropsDone}
                    />
                    <Button
                      className="w-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
                      disabled={advance.isPending || !allDropsDone}
                      title={!allDropsDone ? completionBlockedReason(active) : undefined}
                      onClick={() => advance.mutate(
                        { id: active.id, status: "completed" },
                        { onSuccess: () => toast.success("Trip completed"), onError: (e: any) => toast.error(e?.message ?? "Failed") },
                      )}
                    >
                      Complete trip
                    </Button>
                    {!allDropsDone && (
                      <p className="text-[11px] text-muted-foreground text-center -mt-1">
                        {completionBlockedReason(active)}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Offers — scrollable list, no cap. Every eligible pending offer shows up here. */}
        <div className="px-4 pb-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Ride broadcasts ({offers.length})
          </div>
          {!online ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Go online to see broadcasts.</CardContent></Card>
          ) : offers.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No broadcasts right now. Waiting…</CardContent></Card>
          ) : (
            <div className="space-y-3 max-h-[560px] overflow-y-auto pr-0.5">
              {offers.map((o) => (
                <DriverOfferCard
                  key={o.id}
                  ride={o}
                  approach={approaches[o.id]}
                  countdown={
                    o.broadcastExpiresAt ? <OfferCountdown expiresAt={o.broadcastExpiresAt} /> : undefined
                  }
                  acceptDisabled={accept.isPending || !!active}
                  declineDisabled={reject.isPending}
                  onAccept={() => accept.mutate(o.id, { onSuccess: () => toast.success("Ride accepted!"), onError: (e: any) => toast.error(e?.message ?? "Ride already taken") })}
                  onDecline={() => reject.mutate(o.id, { onSuccess: () => toast("Declined"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}
                />
              ))}
            </div>
          )}
        </div>

        {/* History */}
        {history.length > 0 && (
          <div className="px-4 pb-8">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2 mt-2">Recent trips</div>
            <div className="space-y-2">
              {history.map((r) => (
                <Card
                  key={r.id}
                  className="cursor-pointer hover:border-gold/50 transition-colors"
                  onClick={() => setDetailRideId(r.id)}
                >
                  <CardContent className="p-3 flex items-center justify-between text-sm">
                    <div className="min-w-0">
                      <div className="truncate">{r.pickupAddress} → {r.dropAddress}</div>
                      <div className="text-xs text-muted-foreground capitalize">{r.status}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold">{r.price != null ? `₹${r.price}` : "—"}</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Drop-ride dialog — a reason is required so the supervisor and support
          have something concrete on record, and the fine (if any) is stated
          plainly before the driver commits. */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-base">Can't take this ride?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The ride goes back to other drivers nearby, so the employees still get
              picked up.
            </p>

            {active && arrivedRideIds.has(active.id) ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[11px] text-destructive leading-relaxed">
                You've already confirmed arrival, so a <strong>₹150 fine</strong> applies —
                the supervisor was expecting the cab to be there.
              </div>
            ) : (
              <div className="rounded-md border border-success/40 bg-success/5 px-2.5 py-2 text-[11px] text-success leading-relaxed">
                No fine — you haven't confirmed arrival yet, so there's still time to
                find another driver.
              </div>
            )}

            <Input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason (e.g. breakdown, unwell)"
              maxLength={200}
            />

            <Button
              variant="destructive"
              className="w-full"
              disabled={cancelReason.trim().length < 3 || driverCancel.isPending}
              onClick={() => {
                if (!active) return;
                driverCancel.mutate(
                  { rideId: active.id, reason: cancelReason.trim() },
                  {
                    onSuccess: (r) => {
                      toast.success(
                        r.fine > 0
                          ? `Ride released. ₹${r.fine} fine applied.`
                          : "Ride released — no fine.",
                      );
                      setCancelOpen(false);
                      setAllBoarded(false);
                    },
                    onError: (e: any) => toast.error(e?.message ?? "Could not release the ride"),
                  },
                );
              }}
            >
              Release this ride
            </Button>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setCancelOpen(false)}>
              Keep the ride
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Completed ride detail sheet */}
      <CompletedRideDetailSheet
        rideId={detailRideId}
        onClose={() => setDetailRideId(undefined)}
      />
    </div>
  );
}

// Trip completion is blocked until every employee's drop OTP is verified,
// and — for logout rides with an escort — the escort's own return-drop OTP
// is also verified. Mirrors the gate enforced server-side in maybeComplete().
function completionBlockedReason(ride: RideRow) {
  if (ride.type !== "login" && ride.escortRequired) {
    return "Verify all drop OTPs, then the escort's return-drop OTP, to enable trip completion.";
  }
  return "Verify all drop OTPs to enable trip completion.";
}

/**
 * Countdown to a broadcast's expiry. Broadcasts only live ~3 minutes, so
 * without this the driver has no idea how long an offer will stay acceptable.
 */
function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  // Turn red in the last 30s so it reads as urgent at a glance.
  const urgent = left <= 30;

  return (
    <span
      className={`flex items-center gap-1 font-mono font-semibold shrink-0 ${
        urgent ? "text-destructive animate-pulse" : "text-gold-dark"
      }`}
    >
      <Timer className="h-3.5 w-3.5" />
      {left > 0 ? `${mm}:${ss}` : "expired"}
    </span>
  );
}

function RideSummary({ ride }: { ride: RideRow }) {
  // Driver earnings = fare + escort charge (escort charge belongs to driver)
  const driverEarnings = (ride.price ?? 0) + (ride.escortCharge ?? 0);

  return (
    <div className="space-y-2">
      {/* Top badges row — countdown pinned right while broadcasting */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="capitalize">{ride.type}</Badge>
        <Badge variant="outline" className="capitalize">{ride.status.replace("_", " ")}</Badge>
        {ride.escortRequired && (
          <Badge className="bg-amber-500 text-white gap-1 text-[11px]">
            <Shield className="h-3 w-3" /> Escort Ride
          </Badge>
        )}
        {ride.status === "broadcasting" && ride.broadcastExpiresAt && (
          <span className="ml-auto text-xs">
            <OfferCountdown expiresAt={ride.broadcastExpiresAt} />
          </span>
        )}
      </div>

      {/* Route */}
      <div className="flex items-start gap-2 text-sm">
        <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">{ride.pickupAddress}</div>
          <div className="text-muted-foreground text-xs">→ {ride.dropAddress}</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground bg-gold/10 rounded px-1.5 py-0.5">
          <Users className="h-3.5 w-3.5" />
          {ride.paxCount} passenger{ride.paxCount === 1 ? "" : "s"}
          {ride.escortRequired && " + escort"}
        </span>
        {ride.capacity != null && <span>needs {ride.capacity}-seater</span>}
        {/* Label the distance explicitly — an unlabelled "15.5 km" reads
            ambiguously as either the trip length or how far the driver has to
            travel to reach the pickup. This is the trip itself. */}
        {ride.distanceKm != null && <span>· {ride.distanceKm} km trip</span>}

        {/* Earnings — always show total including escort */}
        {ride.price != null && (
          <span className="flex items-center gap-0.5 font-semibold text-foreground ml-auto">
            <IndianRupee className="h-3 w-3" />
            {driverEarnings}
            {ride.escortRequired && ride.escortCharge != null && (
              <span className="text-amber-600 text-[10px] ml-0.5">(+₹{ride.escortCharge} escort)</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Arrived slider ───────────────────────────────────────────────────────────
// The driver drags the thumb all the way right to confirm they're at the pickup.

function ArrivedSlider({ onArrived, isPending }: { onArrived: () => void; isPending: boolean }) {
  const [value, setValue] = useState(0);
  const confirmed = value >= 95;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setValue(v);
    if (v >= 95) {
      onArrived();
    }
  };

  // Reset if not yet confirmed and user releases thumb mid-way
  const handleRelease = () => {
    if (!confirmed) setValue(0);
  };

  return (
    <div className={`rounded-lg border px-4 py-3 space-y-2 transition-colors ${confirmed ? "border-success/50 bg-success/5" : "border-gold/40 bg-gold/5"}`}>
      <div className="flex items-center gap-2 text-xs font-semibold text-gold-dark">
        <ChevronsRight className="h-3.5 w-3.5 animate-pulse" />
        Slide to confirm arrival at pickup location
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          disabled={isPending || confirmed}
          onChange={handleChange}
          onMouseUp={handleRelease}
          onTouchEnd={handleRelease}
          className="w-full h-10 appearance-none rounded-full cursor-pointer disabled:cursor-default"
          style={{
            background: `linear-gradient(to right, hsl(var(--gold)) ${value}%, hsl(var(--muted)) ${value}%)`,
            WebkitAppearance: "none",
          }}
        />
        {!confirmed && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none select-none">
            {value < 10 ? "Slide right →" : value < 95 ? "Keep going →" : ""}
          </span>
        )}
        {confirmed && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-success font-semibold pointer-events-none select-none">
            ✓ Arrived
          </span>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">
        This stamps your reporting time for on-time delivery tracking.
      </div>
    </div>
  );
}
