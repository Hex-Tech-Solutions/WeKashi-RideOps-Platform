import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useScheduledRides, useDriverRides, useClaimRide, useReleaseRide, type RideRow } from "@/lib/queries";
import { MapPin, Users, IndianRupee, Calendar, Wind, Shield } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { RideTypeBadge } from "@/components/RideTypeLabel";

export default function DriverScheduled() {
  const { data: mkt } = useScheduledRides();
  const { data: mine } = useDriverRides();
  const claim = useClaimRide();
  const release = useReleaseRide();

  const marketplace = mkt?.scheduled ?? [];
  const upcoming = (mine?.rides ?? []).filter((r) => r.status === "assigned" && r.scheduledFor);

  return (
    <div className="px-4 py-4 space-y-5">
      <section>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">My upcoming ({upcoming.length})</div>
        {upcoming.length === 0 ? (
          <Card><CardContent className="p-5 text-center text-sm text-muted-foreground">No upcoming scheduled rides.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {upcoming.map((r) => (
              <Card key={r.id} className="border-gold/40">
                <CardContent className="p-4 space-y-3">
                  <SchedSummary ride={r} />
                  <Button variant="outline" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40" disabled={release.isPending}
                    onClick={() => release.mutate(r.id, {
                      onSuccess: () => toast.success("Ride released"),
                      onError: (e: any) => toast.error(e?.message ?? "Failed"),
                    })}>
                    Release ride
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Available to claim ({marketplace.length})</div>
        {marketplace.length === 0 ? (
          <Card><CardContent className="p-5 text-center text-sm text-muted-foreground">No scheduled rides right now.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {marketplace.map((r) => (
              <Card key={r.id}>
                <CardContent className="p-4 space-y-3">
                  <SchedSummary ride={r} />
                  <Button className="w-full bg-gold text-gold-foreground hover:bg-gold/90" disabled={claim.isPending}
                    onClick={() => claim.mutate(r.id, { onSuccess: () => toast.success("Ride claimed — added to upcoming"), onError: (e: any) => toast.error(e?.message ?? "Already claimed") })}>
                    Claim ride
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SchedSummary({ ride }: { ride: RideRow }) {
  // Driver keeps fare + escort charge — same earning basis as a broadcast offer.
  const earnings = (ride.price ?? 0) + (ride.escortCharge ?? 0);
  return (
    <div className="space-y-2">
      {/* Badges row — type, AC, vehicle, escort — mirrors the broadcast offer card */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <RideTypeBadge type={ride.type} />
          <Badge className={ride.isAc ? "bg-sky-500 text-white gap-1 text-[10px]" : "bg-muted text-muted-foreground gap-1 text-[10px]"}>
            <Wind className="h-3 w-3" /> {ride.isAc ? "AC" : "Non-AC"}
          </Badge>
          {ride.vehicleType && (
            <Badge variant="outline" className="capitalize text-[10px]">{ride.vehicleType}</Badge>
          )}
          {ride.escortRequired && (
            <Badge className="bg-amber-500 text-white gap-1 text-[10px]"><Shield className="h-3 w-3" /> Escort</Badge>
          )}
        </div>
        {ride.scheduledFor && <span className="text-xs flex items-center gap-1 text-gold shrink-0"><Calendar className="h-3.5 w-3.5" />{format(new Date(ride.scheduledFor), "EEE d MMM, HH:mm")}</span>}
      </div>

      <div className="flex items-start gap-2 text-sm">
        <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
        <div><div className="font-medium">{ride.pickupAddress}</div><div className="text-muted-foreground text-xs">→ {ride.dropAddress}</div></div>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1 font-medium text-foreground bg-gold/10 rounded px-1.5 py-0.5">
          <Users className="h-3.5 w-3.5" /> {ride.paxCount} passenger{ride.paxCount === 1 ? "" : "s"}{ride.escortRequired ? " + escort" : ""}
        </span>
        {ride.capacity != null && <span>needs {ride.capacity}-seater</span>}
        {ride.distanceKm != null && <span>· {ride.distanceKm} km trip</span>}
        {ride.price != null && (
          <span className="flex items-center gap-0.5 font-semibold text-foreground ml-auto">
            <IndianRupee className="h-3 w-3" />{earnings}
            {ride.escortRequired && ride.escortCharge != null && (
              <span className="text-amber-600 text-[10px] ml-0.5">(+₹{ride.escortCharge} escort)</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
