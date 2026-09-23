/**
 * Recent trips list for the driver account side panel. Shows completed and
 * cancelled rides; tapping one opens the completed-ride detail sheet. Moved
 * here out of DriverHome so the home screen stays focused on going online and
 * live broadcasts.
 *
 * For a completed ride the supervisor has paid directly by UPI, the driver sees
 * the last-4 UTR the supervisor entered and can confirm receipt after matching
 * it against their bank credit.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight, CheckCircle2, Loader2, BadgeIndianRupee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDriverRides, useMarkRideReceived, type RideRow } from "@/lib/queries";
import { CompletedRideDetailSheet } from "@/components/CompletedRideDetailSheet";
import { toast } from "sonner";

export function DriverRecentTrips() {
  const { data: ridesData } = useDriverRides();
  const rides = ridesData?.rides ?? [];
  const history = rides.filter((r) => ["completed", "cancelled"].includes(r.status));
  const [detailRideId, setDetailRideId] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-2">
      {history.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-8 border-2 border-dashed rounded-lg">
          No trips yet. Completed rides will show up here.
        </div>
      ) : (
        history.map((r) => (
          <Card
            key={r.id}
            className="hover:border-gold/50 transition-colors"
          >
            <CardContent className="p-3 space-y-2">
              <div
                className="flex items-center justify-between text-sm cursor-pointer"
                onClick={() => setDetailRideId(r.id)}
              >
                <div className="min-w-0">
                  <div className="truncate">{r.pickupAddress} → {r.dropAddress}</div>
                  <div className="text-xs text-muted-foreground capitalize">{r.status}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold">{r.price != null ? `₹${r.price}` : "—"}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              {r.status === "completed" && r.paymentStatus === "paid" && r.paymentRef && (
                <PaymentReceipt ride={r} />
              )}
            </CardContent>
          </Card>
        ))
      )}

      <CompletedRideDetailSheet
        rideId={detailRideId}
        onClose={() => setDetailRideId(undefined)}
      />
    </div>
  );
}

/** UTR receipt + "mark as received" for a supervisor-paid ride. */
function PaymentReceipt({ ride }: { ride: RideRow }) {
  const markReceived = useMarkRideReceived();
  const received = !!ride.paymentReceivedAt;

  return (
    <div className="rounded-lg border bg-muted/30 p-2.5 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <BadgeIndianRupee className="h-3.5 w-3.5" />
          Paid by supervisor
        </span>
        <span className="font-mono">UTR ••••{ride.paymentRef}</span>
      </div>
      {received ? (
        <div className="flex items-center gap-1.5 text-success font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" /> Payment received
        </div>
      ) : (
        <Button
          size="sm"
          className="w-full bg-success text-success-foreground hover:bg-success/90 h-8"
          onClick={() =>
            markReceived.mutate(ride.id, {
              onSuccess: () => toast.success("Marked as received"),
              onError: (e: any) => toast.error(e?.message ?? "Could not update"),
            })
          }
          disabled={markReceived.isPending}
        >
          {markReceived.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> …</>
            : <><CheckCircle2 className="h-3.5 w-3.5" /> Verify UTR & mark received</>}
        </Button>
      )}
    </div>
  );
}
