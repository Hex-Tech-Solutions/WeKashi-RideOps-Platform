/**
 * Recent trips list for the driver account side panel. Shows completed and
 * cancelled rides; tapping one opens the completed-ride detail sheet. Moved
 * here out of DriverHome so the home screen stays focused on going online and
 * live broadcasts.
 */
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { useDriverRides } from "@/lib/queries";
import { CompletedRideDetailSheet } from "@/components/CompletedRideDetailSheet";

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
        ))
      )}

      <CompletedRideDetailSheet
        rideId={detailRideId}
        onClose={() => setDetailRideId(undefined)}
      />
    </div>
  );
}
