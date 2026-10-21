import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useScheduledRides, useDriverRides, useClaimRide, useReleaseRide } from "@/lib/queries";
import { format } from "date-fns";
import { toast } from "sonner";
import { DriverOfferCard } from "./DriverOfferCard";
import { DriverRentalBrowse } from "./DriverRentalBrowse";

export default function DriverScheduled() {
  const { data: mkt } = useScheduledRides();
  const { data: mine } = useDriverRides();
  const claim = useClaimRide();
  const release = useReleaseRide();

  // Dismissed marketplace rides — hidden from this driver's list for the
  // session (so a ride they're not interested in stops cluttering the view).
  // Local only; it reappears on a full reload, matching a soft "not now".
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const dismiss = (id: string) => setDismissed((s) => new Set(s).add(id));

  const marketplace = (mkt?.scheduled ?? []).filter((r) => !dismissed.has(r.id));
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
              <DriverOfferCard
                key={r.id}
                ride={r}
                scheduledDate={r.scheduledFor ? format(new Date(r.scheduledFor), "EEE d MMM") : undefined}
                footer={
                  <Button
                    variant="outline"
                    className="w-full h-10 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"
                    disabled={release.isPending}
                    onClick={() => release.mutate(r.id, {
                      onSuccess: () => toast.success("Ride released"),
                      onError: (e: any) => toast.error(e?.message ?? "Failed"),
                    })}
                  >
                    Release ride
                  </Button>
                }
              />
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
              <DriverOfferCard
                key={r.id}
                ride={r}
                scheduledDate={r.scheduledFor ? format(new Date(r.scheduledFor), "EEE d MMM") : undefined}
                footer={
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="h-10 flex-1 text-muted-foreground"
                      onClick={() => dismiss(r.id)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      className="h-10 flex-[2] bg-gold text-gold-foreground hover:bg-gold/90"
                      disabled={claim.isPending}
                      onClick={() => claim.mutate(r.id, {
                        onSuccess: () => toast.success("Ride claimed — added to upcoming"),
                        onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Already claimed"),
                      })}
                    >
                      Claim ride
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Rentals — a secondary service a free driver can pick up. */}
      <DriverRentalBrowse />
    </div>
  );
}
