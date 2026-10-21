import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlacesInput } from "@/components/PlacesInput";
import {
  useAirportRides, useCreateAirportRide, useCancelAirportRide, useComputeRoute,
  type AirportRideRow,
} from "@/lib/queries";
import {
  airportFare, AIRPORT_TERMINALS, VEHICLE_LABELS, type VehicleType, type AirportTerminal,
} from "@/lib/pricing";
import { Plane, PlaneTakeoff, PlaneLanding, Loader2, IndianRupee, Phone, KeyRound, X, Radio, Clock, MapPin } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Direction = "to_airport" | "from_airport";

export default function Airport() {
  const { data } = useAirportRides();
  const rides = data?.rides ?? [];
  return (
    <div className="w-full">
      <PageHeader
        title="Airport"
        description="Book single-passenger transfers to and from the airport terminals."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <AirportBookingForm />
        <AirportRidesList rides={rides} />
      </div>
    </div>
  );
}

// ─── Booking form ─────────────────────────────────────────────────────────────

function AirportBookingForm() {
  const createRide = useCreateAirportRide();
  const computeRoute = useComputeRoute();

  const [direction, setDirection] = useState<Direction>("to_airport");
  const [terminal, setTerminal] = useState<AirportTerminal>("T1");
  const [city, setCity] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [paxName, setPaxName] = useState("");
  const [paxPhone, setPaxPhone] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType>("sedan");
  const [scheduleAt, setScheduleAt] = useState<string>("");

  // Distance + toll from the backend Routes API, recomputed whenever the city
  // point, terminal, or direction changes. The fixed terminal is one end.
  const [route, setRoute] = useState<{ km: number; tollInr: number | null } | null>(null);

  useEffect(() => {
    if (!city) { setRoute(null); return; }
    const term = AIRPORT_TERMINALS[terminal];
    const origin = direction === "to_airport" ? { lat: city.lat, lng: city.lng } : { lat: term.lat, lng: term.lng };
    const destination = direction === "to_airport" ? { lat: term.lat, lng: term.lng } : { lat: city.lat, lng: city.lng };
    let cancelled = false;
    computeRoute.mutate(
      { origin, destination },
      {
        onSuccess: (res) => {
          if (cancelled) return;
          setRoute({ km: Math.round((res.distanceMeters / 1000) * 10) / 10, tollInr: res.tollInr ?? null });
        },
        onError: () => { if (!cancelled) setRoute(null); },
      },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city?.lat, city?.lng, terminal, direction]);

  const fare = route ? airportFare(route.km, vehicleType) : null;
  const toll = route?.tollInr && route.tollInr > 0 ? route.tollInr : 0;
  const total = fare != null ? fare + toll : null;

  const cityLabel = direction === "to_airport" ? "Pickup location" : "Drop location";

  const reset = () => {
    setCity(null); setPaxName(""); setPaxPhone("");
    setScheduleAt(""); setRoute(null);
  };

  const submit = (scheduled: boolean) => {
    if (!city) { toast.error("Set the " + cityLabel.toLowerCase()); return; }
    if (!paxName.trim()) { toast.error("Enter the passenger name"); return; }
    if (paxPhone.trim().length < 10) { toast.error("Enter a valid mobile number"); return; }
    if (route == null) { toast.error("Wait for the route distance to calculate"); return; }
    let scheduledFor: string | undefined;
    if (scheduled) {
      if (!scheduleAt) { toast.error("Pick a date & time"); return; }
      const when = new Date(scheduleAt);
      if (isNaN(when.getTime()) || when.getTime() <= Date.now()) { toast.error("Scheduled time must be in the future"); return; }
      scheduledFor = when.toISOString();
    }
    createRide.mutate(
      {
        direction, terminal,
        cityPoint: { lat: city.lat, lng: city.lng },
        cityAddress: city.address,
        paxName: paxName.trim(),
        paxPhone: paxPhone.trim(),
        vehicleType,
        distanceKm: route.km,
        tollCharge: toll > 0 ? toll : undefined,
        scheduledFor,
      },
      {
        onSuccess: (res) => {
          toast.success(scheduled ? "Airport ride scheduled" : `Broadcast sent — ${res.nearbyCount} driver(s) nearby`);
          reset();
        },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Booking failed"),
      },
    );
  };

  return (
    <Card className="shadow-card h-fit">
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plane className="h-4 w-4" /> New airport ride</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* Direction */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection("to_airport")}
            className={`rounded-md border px-3 py-2 text-sm flex items-center justify-center gap-1.5 ${direction === "to_airport" ? "border-gold bg-gold/10 text-gold-dark font-medium" : "border-border hover:border-gold/40"}`}
          >
            <PlaneTakeoff className="h-4 w-4" /> To airport
          </button>
          <button
            type="button"
            onClick={() => setDirection("from_airport")}
            className={`rounded-md border px-3 py-2 text-sm flex items-center justify-center gap-1.5 ${direction === "from_airport" ? "border-gold bg-gold/10 text-gold-dark font-medium" : "border-border hover:border-gold/40"}`}
          >
            <PlaneLanding className="h-4 w-4" /> From airport
          </button>
        </div>

        {/* Terminal */}
        <div>
          <Label className="text-xs">Terminal</Label>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {(["T1", "T2"] as AirportTerminal[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTerminal(t)}
                className={`rounded-md border px-3 py-2 text-sm ${terminal === t ? "border-gold bg-gold/10 text-gold-dark font-medium" : "border-border hover:border-gold/40"}`}
              >
                {AIRPORT_TERMINALS[t].name}
              </button>
            ))}
          </div>
        </div>

        {/* City point */}
        <div>
          <Label className="text-xs">{cityLabel}</Label>
          <PlacesInput
            placeholder={`Search ${cityLabel.toLowerCase()}`}
            onSelect={(v) => setCity(v)}
          />
          {city && <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1"><MapPin className="h-3 w-3" /> {city.address}</div>}
        </div>

        {/* Passenger details */}
        <div className="grid gap-2">
          <div>
            <Label className="text-xs">Passenger name</Label>
            <Input value={paxName} onChange={(e) => setPaxName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <Label className="text-xs">Mobile number</Label>
            <Input value={paxPhone} onChange={(e) => setPaxPhone(e.target.value)} placeholder="10-digit mobile" inputMode="tel" />
          </div>
        </div>

        {/* Vehicle */}
        <div>
          <Label className="text-xs">Vehicle</Label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            {(["hatchback", "sedan", "suv"] as VehicleType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setVehicleType(t)}
                className={`rounded-md border px-2 py-2 text-xs ${vehicleType === t ? "border-gold bg-gold/10 text-gold-dark font-medium" : "border-border hover:border-gold/40"}`}
              >
                {VEHICLE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Fare preview */}
        <div className="rounded-md bg-secondary p-3 space-y-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Distance</span>
            <span>{route ? `${route.km} km` : computeRoute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : "—"}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Fare ({VEHICLE_LABELS[vehicleType]})</span>
            <span>{fare != null ? `₹${fare}` : "—"}</span>
          </div>
          {toll > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Toll (est.)</span>
              <span>+₹{toll}</span>
            </div>
          )}
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between font-semibold">
            <span>Total</span>
            <span className="text-lg">{total != null ? `₹${total}` : "—"}</span>
          </div>
        </div>

        {/* Actions */}
        <Button
          className="w-full bg-gold text-gold-foreground hover:bg-gold/90"
          disabled={createRide.isPending || total == null}
          onClick={() => submit(false)}
        >
          <Radio className="h-4 w-4" /> Broadcast now
        </Button>
        <div className="pt-2 border-t space-y-2">
          <Label className="text-xs">Or schedule for later</Label>
          <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
          <Button variant="outline" className="w-full" disabled={createRide.isPending || total == null} onClick={() => submit(true)}>
            <Clock className="h-4 w-4" /> Schedule
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Status list ────────────────────────────────────────────────────────────

function AirportRidesList({ rides }: { rides: AirportRideRow[] }) {
  const cancelRide = useCancelAirportRide();
  const [cancelId, setCancelId] = useState<string | null>(null);

  if (rides.length === 0) {
    return (
      <Card className="shadow-card">
        <CardContent className="py-16 text-center space-y-3">
          <Plane className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <div className="font-medium">No airport rides yet</div>
          <div className="text-sm text-muted-foreground">Book one from the form on the left.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rides.map((r) => (
        <AirportRideCard key={r.id} ride={r} onCancel={() => setCancelId(r.id)} />
      ))}

      <AlertDialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this airport ride?</AlertDialogTitle>
            <AlertDialogDescription>
              The ride will be cancelled. You can only cancel before the trip has started.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (cancelId) {
                  cancelRide.mutate(cancelId, {
                    onSuccess: () => toast.success("Ride cancelled"),
                    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not cancel"),
                  });
                }
                setCancelId(null);
              }}
            >
              Cancel ride
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  broadcasting: "bg-blue-500/15 text-blue-700",
  scheduled: "bg-purple-500/15 text-purple-700",
  assigned: "bg-amber-500/15 text-amber-700",
  in_progress: "bg-green-500/15 text-green-700",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/15 text-destructive",
  expired: "bg-destructive/10 text-destructive",
};

function AirportRideCard({ ride: r, onCancel }: { ride: AirportRideRow; onCancel: () => void }) {
  // Supervisor may cancel before the trip has started (not in_progress/completed/cancelled/expired).
  const canCancel = !["in_progress", "completed", "cancelled", "expired"].includes(r.status);
  // OTPs are relayed by the supervisor. Show the pickup OTP until pickup is done,
  // then the drop OTP until drop is done.
  const showPickupOtp = r.status === "assigned" && !r.airportPickupAt;
  const showDropOtp = r.status === "in_progress" && !r.airportDropAt;
  const dirLabel = r.airportDirection === "to_airport" ? "To airport" : "From airport";

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {r.airportDirection === "to_airport" ? <PlaneTakeoff className="h-4 w-4 text-gold-dark" /> : <PlaneLanding className="h-4 w-4 text-gold-dark" />}
            <span className="font-semibold text-sm">{dirLabel}</span>
            <Badge variant="outline" className="text-[10px] py-0">{r.airportTerminal}</Badge>
            {r.vehicleType && <Badge variant="outline" className="text-[10px] py-0 capitalize">{r.vehicleType}</Badge>}
          </div>
          <Badge className={`text-[10px] py-0 capitalize ${STATUS_STYLES[r.status] ?? ""}`}>{r.status.replace("_", " ")}</Badge>
        </div>

        <div className="text-xs space-y-1">
          <div className="flex items-center gap-1.5"><span className="font-medium">{r.paxName}</span>
            <span className="text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {r.paxPhone}</span>
          </div>
          <div className="text-muted-foreground">{r.pickupAddress} → {r.dropAddress}</div>
          {r.scheduledFor && <div className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {format(new Date(r.scheduledFor), "EEE d MMM, HH:mm")}</div>}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{r.distanceKm != null ? `${r.distanceKm} km` : ""}</span>
          <span className="font-semibold flex items-center gap-0.5">
            <IndianRupee className="h-3.5 w-3.5" />{r.totalAmount ?? r.price ?? "—"}
            {r.tollCharge ? <span className="text-[11px] text-muted-foreground ml-1">(incl. ₹{r.tollCharge} toll)</span> : null}
          </span>
        </div>

        {r.driver && (
          <div className="text-xs text-muted-foreground">
            Driver: <span className="text-foreground font-medium">{r.driver.fullName}</span> · {r.driver.phone}
            {r.driver.vehicle?.regNo ? ` · ${r.driver.vehicle.regNo}` : ""}
          </div>
        )}

        {/* OTP relay — supervisor reads this to the driver */}
        {(showPickupOtp || showDropOtp) && (
          <div className="rounded-md border border-gold/40 bg-gold/5 px-3 py-2 flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-gold-dark shrink-0" />
            <div className="text-xs">
              <div className="text-muted-foreground">{showPickupOtp ? "Pickup OTP — read to driver" : "Drop OTP — read to driver"}</div>
              <div className="font-mono text-lg font-bold tracking-widest text-gold-dark">
                {showPickupOtp ? r.airportPickupOtp : r.airportDropOtp}
              </div>
            </div>
          </div>
        )}

        {canCancel && (
          <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={onCancel}>
            <X className="h-3.5 w-3.5" /> Cancel ride
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
