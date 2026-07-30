import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TripProgress } from "@/components/TripProgress";
import { LiveCabMap } from "@/components/LiveCabMap";
import { useRides, useLiveDriverLocations } from "@/lib/queries";
import { statusColor } from "@/lib/rideStatus";
import { Route } from "lucide-react";

export default function Live() {
  const { data } = useRides({ limit: 100 });
  const { data: liveDrivers } = useLiveDriverLocations();
  const rides = data?.rides ?? [];
  const live = rides.filter((r) => ["broadcasting", "assigned", "in_progress"].includes(r.status));
  const cabs = liveDrivers?.drivers ?? [];

  return (
    <div>
      <PageHeader title="Live Tracking" description="Every active cab and ride across the platform." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-card">
          <CardHeader><CardTitle className="text-base">All cabs · live ({cabs.length} online)</CardTitle></CardHeader>
          <CardContent>
            <LiveCabMap drivers={cabs} height={520} />
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Active rides ({live.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[520px] overflow-auto">
            {live.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">No active rides right now.</div>}
            {live.map((r) => (
              <div key={r.id} className="w-full text-left p-3 rounded border text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                  <Badge variant="outline" className={statusColor(r.status) + " text-[10px]"}>{r.status.replace("_", " ")}</Badge>
                </div>
                <div className="text-xs">{r.pickupAddress} → {r.dropAddress}</div>
                <div className="text-xs text-muted-foreground">{r.driver?.fullName ?? "Awaiting driver"} · {r.supervisor?.fullName ?? "—"}</div>
                {["assigned", "in_progress"].includes(r.status) && (
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs mt-1"><Route className="h-3 w-3" /> Trip & OTPs</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Trip progress</DialogTitle></DialogHeader>
                      <TripProgress rideId={r.id} type={r.type} />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
