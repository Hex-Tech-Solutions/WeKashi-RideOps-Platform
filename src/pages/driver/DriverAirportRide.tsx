import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  useRide, useVerifyAirportPickup, useVerifyAirportDrop,
  type RideRow,
} from "@/lib/queries";
import { mapsUrl, mapsUrlForAddress } from "@/lib/queries";
import { PlaneTakeoff, PlaneLanding, Navigation, Phone, KeyRound, IndianRupee, MapPin, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Driver's active-ride card for an AIRPORT ride. Airport rides have no
 * passengers/boarding — a single pax entered by the supervisor — so this
 * replaces the normal pax-based DriverTrip/DriverBoarding flow. The driver:
 *   assigned     → navigate to pickup → enter the supervisor-relayed pickup OTP
 *   in_progress  → navigate to drop   → enter the supervisor-relayed drop OTP
 *   completed    → done
 */
export function DriverAirportRide({ ride }: { ride: RideRow }) {
  const { data: full } = useRide(ride.id);
  const verifyPickup = useVerifyAirportPickup();
  const verifyDrop = useVerifyAirportDrop();
  const [otp, setOtp] = useState("");

  const dirLabel = ride.airportDirection === "to_airport" ? "To airport" : "From airport";
  const DirIcon = ride.airportDirection === "to_airport" ? PlaneTakeoff : PlaneLanding;

  const pickupLat = full?.pickupLat;
  const pickupLng = full?.pickupLng;
  const dropLat = full?.dropLat;
  const dropLng = full?.dropLng;

  const stage: "pickup" | "drop" | "done" =
    ride.status === "assigned" ? "pickup" : ride.status === "in_progress" ? "drop" : "done";

  const submitOtp = () => {
    const code = otp.trim();
    if (code.length < 4) { toast.error("Enter the 4-digit OTP"); return; }
    if (stage === "pickup") {
      verifyPickup.mutate({ rideId: ride.id, otp: code }, {
        onSuccess: () => { toast.success("Pickup verified — trip started"); setOtp(""); },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Incorrect OTP"),
      });
    } else if (stage === "drop") {
      verifyDrop.mutate({ rideId: ride.id, otp: code }, {
        onSuccess: () => { toast.success("Drop verified — ride complete"); setOtp(""); },
        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Incorrect OTP"),
      });
    }
  };

  const navTarget = stage === "pickup"
    ? (pickupLat != null && pickupLng != null ? mapsUrl(pickupLat, pickupLng) : mapsUrlForAddress(ride.pickupAddress))
    : (dropLat != null && dropLng != null ? mapsUrl(dropLat, dropLng) : mapsUrlForAddress(ride.dropAddress));
  const navLabel = stage === "pickup" ? "Navigate to pickup" : "Navigate to drop";

  return (
    <Card className="border-gold/50">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <DirIcon className="h-4 w-4 text-gold-dark" />
          <span className="font-semibold text-sm">{dirLabel}</span>
          <Badge variant="outline" className="text-[10px] py-0">{ride.airportTerminal}</Badge>
          {ride.vehicleType && <Badge variant="outline" className="text-[10px] py-0 capitalize">{ride.vehicleType}</Badge>}
          <Badge variant="outline" className="text-[10px] py-0 capitalize">{ride.status.replace("_", " ")}</Badge>
        </div>

        {/* Passenger */}
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium">{ride.paxName}</span>
            {ride.paxPhone && (
              <a href={`tel:${ride.paxPhone}`} className="text-gold-dark flex items-center gap-1"><Phone className="h-3 w-3" /> {ride.paxPhone}</a>
            )}
          </div>
          <div className="text-muted-foreground flex items-start gap-1">
            <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{ride.pickupAddress} → {ride.dropAddress}</span>
          </div>
        </div>

        {/* Fare */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{ride.distanceKm != null ? `${ride.distanceKm} km` : ""}</span>
          <span className="font-semibold flex items-center gap-0.5"><IndianRupee className="h-3.5 w-3.5" />{ride.totalAmount ?? ride.price ?? "—"}</span>
        </div>

        {stage === "done" ? (
          <div className="flex items-center justify-center gap-2 text-success text-sm py-2">
            <CheckCircle2 className="h-4 w-4" /> Ride completed
          </div>
        ) : (
          <>
            <a
              href={navTarget}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
            >
              <Navigation className="h-4 w-4" /> {navLabel} — open maps
            </a>

            {/* OTP entry — the supervisor reads this to the driver */}
            <div className="rounded-md border px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-gold-dark" />
                <span className="font-medium">
                  {stage === "pickup" ? "Enter pickup OTP" : "Enter drop OTP"}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Ask the supervisor for the {stage} OTP and enter it to {stage === "pickup" ? "start" : "complete"} the ride.
              </div>
              <div className="flex gap-2">
                <Input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="4-digit OTP"
                  inputMode="numeric"
                  className="font-mono tracking-widest text-center"
                />
                <Button
                  className="bg-gold text-gold-foreground hover:bg-gold/90 shrink-0"
                  disabled={verifyPickup.isPending || verifyDrop.isPending}
                  onClick={submitOtp}
                >
                  {stage === "pickup" ? "Start" : "Complete"}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
