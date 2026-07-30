import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  useDriverMe, useDriverOffers, useDriverRides,
  useGoOnline, useGoOffline, useUpdateDriverLocation, useAcceptOffer, useRejectOffer, useAdvanceRideStatus,
  useRide, useMarkDriverArrived,
  type RideRow,
} from "@/lib/queries";
import { MapPin, Users, IndianRupee, Check, X, LocateFixed, ChevronRight, ChevronsRight } from "lucide-react";
import { toast } from "sonner";
import DriverTrip from "./DriverTrip";
import { getDevicePosition, watchDevicePosition } from "@/lib/deviceLocation";
import { CompletedRideDetailSheet } from "@/components/CompletedRideDetailSheet";

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

  // Track which assigned rides the driver has already confirmed arrival for
  const [arrivedRideIds, setArrivedRideIds] = useState<Set<string>>(new Set());

  // Completed-ride detail sheet
  const [detailRideId, setDetailRideId] = useState<string | undefined>(undefined);

  // Fetch full ride detail for the active ride so we have drop lat/lng.
  const { data: activeRideFull } = useRide(active?.id);

  // While online, watch the device GPS and push live location to the server.
  useEffect(() => {
    if (!online) return;
    const stop = watchDevicePosition((c) => updateLocation.mutate(c));
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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
                    <Button className="w-full bg-gold text-gold-foreground hover:bg-gold/90" disabled={advance.isPending}
                      onClick={() => advance.mutate({ id: active.id, status: "in_progress" }, { onSuccess: () => toast.success("Trip started"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}>
                      Start trip
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
                      title={!allDropsDone ? "Verify all drop OTPs before completing the trip" : undefined}
                      onClick={() => advance.mutate(
                        { id: active.id, status: "completed" },
                        { onSuccess: () => toast.success("Trip completed"), onError: (e: any) => toast.error(e?.message ?? "Failed") },
                      )}
                    >
                      Complete trip
                    </Button>
                    {!allDropsDone && (
                      <p className="text-[11px] text-muted-foreground text-center -mt-1">
                        Verify all drop OTPs to enable trip completion.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Offers */}
        <div className="px-4 pb-2">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Ride broadcasts ({offers.length})</div>
          {!online ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Go online to see broadcasts.</CardContent></Card>
          ) : offers.length === 0 ? (
            <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">No broadcasts right now. Waiting…</CardContent></Card>
          ) : (
            <div className="space-y-3">
              {offers.map((o) => (
                <Card key={o.id} className="border-gold/30">
                  <CardContent className="p-4 space-y-3">
                    <RideSummary ride={o} />
                    <div className="flex gap-2">
                      <Button className="flex-1 bg-gold text-gold-foreground hover:bg-gold/90" disabled={accept.isPending || !!active}
                        onClick={() => accept.mutate(o.id, { onSuccess: () => toast.success("Ride accepted!"), onError: (e: any) => toast.error(e?.message ?? "Ride already taken") })}>
                        <Check className="h-4 w-4" /> Accept
                      </Button>
                      <Button variant="outline" className="flex-1" disabled={reject.isPending}
                        onClick={() => reject.mutate(o.id, { onSuccess: () => toast("Declined"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}>
                        <X className="h-4 w-4" /> Decline
                      </Button>
                    </div>
                  </CardContent>
                </Card>
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

      {/* Completed ride detail sheet */}
      <CompletedRideDetailSheet
        rideId={detailRideId}
        onClose={() => setDetailRideId(undefined)}
      />
    </div>
  );
}

function RideSummary({ ride }: { ride: RideRow }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="capitalize">{ride.type}</Badge>
        <Badge variant="outline" className="capitalize">{ride.status.replace("_", " ")}</Badge>
      </div>
      <div className="flex items-start gap-2 text-sm">
        <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">{ride.pickupAddress}</div>
          <div className="text-muted-foreground text-xs">→ {ride.dropAddress}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
        <span className="flex items-center gap-1 font-medium text-foreground bg-gold/10 rounded px-1.5 py-0.5">
          <Users className="h-3.5 w-3.5" /> {ride.paxCount} passenger{ride.paxCount === 1 ? "" : "s"}
        </span>
        {ride.capacity != null && <span>needs {ride.capacity}-seater</span>}
        {ride.distanceKm != null && <span>· {ride.distanceKm} km</span>}
        {ride.price != null && <span className="flex items-center gap-0.5 font-semibold text-foreground ml-auto"><IndianRupee className="h-3 w-3" />{ride.price}</span>}
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
