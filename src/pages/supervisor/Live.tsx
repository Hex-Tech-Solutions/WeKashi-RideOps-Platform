import { useEffect, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRides, useCancelRide, useRebroadcastRide, useRide, type RideRow } from "@/lib/queries";
import { statusColor } from "@/lib/rideStatus";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TripProgress } from "@/components/TripProgress";
import { AssignDriverDialog } from "@/components/AssignDriverDialog";
import { CompletedRideDetailSheet } from "@/components/CompletedRideDetailSheet";
import { LiveRideTracker } from "@/components/LiveRideTracker";
import { DriverApproachBadge } from "@/components/DriverApproachBadge";
import { Phone, Radio, AlertTriangle, Plus, Route, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function Live() {
  const { data } = useRides({ limit: 100 });
  const cancelRide = useCancelRide();
  const rebroadcast = useRebroadcastRide();

  const [assignRideId, setAssignRideId] = useState<string | null>(null);
  const [detailRideId, setDetailRideId] = useState<string | undefined>(undefined);
  const rides = data?.rides ?? [];
  const schedOverdue = (r: RideRow) => r.status === "scheduled" && !!r.scheduledFor && new Date(r.scheduledFor).getTime() - Date.now() < 4 * 3600 * 1000;
  const liveList = rides.filter((r) => ["broadcasting", "assigned", "in_progress"].includes(r.status) && !r.scheduledFor);
  const scheduledList = rides.filter((r) => (r.status === "scheduled" && !schedOverdue(r)) || (r.status === "assigned" && !!r.scheduledFor));
  const attentionList = rides.filter((r) => ["expired", "cancelled", "pending"].includes(r.status) || schedOverdue(r));
  const completedList = rides.filter((r) => r.status === "completed");
  const broadcasting = rides.find((r) => r.status === "broadcasting");

  return (
    <div>
      <PageHeader
        title="Live rides"
        description="Active broadcasts, ongoing rides, and rides needing attention."
        actions={
          <Button asChild className="bg-foreground text-background hover:bg-foreground/90">
            <Link to="/supervisor/routes"><Plus className="h-4 w-4" /> New booking</Link>
          </Button>
        }
      />

      {broadcasting && (
        <BroadcastingBanner ride={broadcasting} onCancel={() => cancelRide.mutate(broadcasting.id, {
          onSuccess: () => toast.success("Broadcast cancelled"),
          onError: (e: any) => toast.error(e?.message ?? "Failed"),
        })} />
      )}

      <Tabs defaultValue="active" className="mt-2">
        <TabsList>
          <TabsTrigger value="active">Active ({liveList.length})</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled ({scheduledList.length})</TabsTrigger>
          <TabsTrigger value="attention">Needs attention ({attentionList.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({completedList.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          {liveList.length === 0 ? (
            <Empty title="No active rides" hint="Create a new booking to get started." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {liveList.map((r) => <RideCard key={r.id} ride={r} onCancel={() => cancelRide.mutate(r.id, { onSuccess: () => toast.success("Ride cancelled"), onError: (e: any) => toast.error(e?.message ?? "Failed") })} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="scheduled" className="mt-4">
          {scheduledList.length === 0 ? (
            <Empty title="No scheduled rides" hint="Use 'Schedule ride' in a booking to post one for drivers to claim." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {scheduledList.map((r) => (
                <RideCard key={r.id} ride={r}
                  onCancel={() => cancelRide.mutate(r.id, { onSuccess: () => toast.success("Scheduled ride cancelled"), onError: (e: any) => toast.error(e?.message ?? "Failed") })} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="attention" className="mt-4 space-y-4">
          {attentionList.length === 0 ? (
            <Empty title="Nothing needs attention" hint="Expired or cancelled rides can be re-broadcast here." />
          ) : (
            attentionList.map((r) => schedOverdue(r) ? (
              <Card key={r.id} className="shadow-card border-warning/40 bg-warning/5">
                <CardContent className="p-5 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1"><AlertTriangle className="h-4 w-4 text-warning" /><span className="font-mono text-sm">{r.id.slice(0, 8)}</span><Badge variant="outline" className={statusColor(r.status)}>unclaimed scheduled</Badge></div>
                    <div className="font-medium">{r.pickupAddress} → {r.dropAddress}</div>
                    <div className="text-xs text-muted-foreground">No driver claimed · {r.paxCount} PAX{r.totalAmount != null ? ` · ₹${r.totalAmount}` : r.price != null ? ` · ₹${r.price}` : ""}</div>
                  </div>
                  <div className="flex gap-2">
                    <Dialog>
                      <DialogTrigger asChild><Button variant="outline"><Route className="h-3.5 w-3.5" /> Trip &amp; OTPs</Button></DialogTrigger>
                      <DialogContent><DialogHeader><DialogTitle>Trip progress</DialogTitle></DialogHeader><TripProgress rideId={r.id} type={r.type} /></DialogContent>
                    </Dialog>
                    <Button onClick={() => setAssignRideId(r.id)} className="bg-gold text-gold-foreground hover:bg-gold/90 shadow-gold">Find &amp; assign driver</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <AttentionRow key={r.id} ride={r}
                canRebroadcast={["expired", "cancelled", "pending"].includes(r.status)}
                onAssign={() => setAssignRideId(r.id)}
                onRebroadcast={() => rebroadcast.mutate(r.id, {
                  onSuccess: () => toast.success("Re-broadcast initiated"),
                  onError: (e: any) => toast.error(e?.message ?? "Failed"),
                })} />
            ))
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {completedList.length === 0 ? (
            <Empty title="No completed rides yet" hint="Completed trips will appear here." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {completedList.map((r) => (
                <div
                  key={r.id}
                  className="cursor-pointer group"
                  onClick={() => setDetailRideId(r.id)}
                >
                  <RideCard ride={r} showDetailHint />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

      </Tabs>

      <AssignDriverDialog rideId={assignRideId} open={!!assignRideId} onOpenChange={(o) => !o && setAssignRideId(null)} />

      <CompletedRideDetailSheet
        rideId={detailRideId}
        onClose={() => setDetailRideId(undefined)}
      />
    </div>
  );
}

function secondsLeft(expiresAt?: string | null): number {
  if (!expiresAt) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function BroadcastingBanner({ ride, onCancel }: { ride: RideRow; onCancel: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = secondsLeft(ride.broadcastExpiresAt);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <Card className="mb-6 border-gold/50 shadow-gold bg-gold-soft/30">
      <CardContent className="p-5 flex flex-wrap items-center gap-6">
        <div className="h-12 w-12 rounded-full bg-gold/20 flex items-center justify-center">
          <Radio className="h-5 w-5 text-gold-dark animate-pulse" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs uppercase tracking-wider text-gold-dark font-semibold">Broadcasting</div>
          <div className="font-bold text-lg">{ride.pickupAddress}</div>
          <div className="text-sm text-muted-foreground">Online drivers within 10 km notified · {ride.paxCount} PAX</div>
        </div>
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Time left</div>
          <div className="text-3xl font-mono font-bold text-gold-dark">{mm}:{ss}</div>
        </div>
        <Button variant="outline" onClick={onCancel}>Cancel broadcast</Button>
      </CardContent>
    </Card>
  );
}

function RideCard({ ride, onCancel, showDetailHint }: { ride: RideRow; onCancel?: () => void; showDetailHint?: boolean }) {
  const canCancel = onCancel && !["completed", "cancelled", "in_progress"].includes(ride.status);
  // Fetch full ride for drop coords — only when in_progress
  const { data: rideFull } = useRide(ride.status === "in_progress" ? ride.id : undefined);

  return (
    <Card className={`shadow-card ${showDetailHint ? "group-hover:border-gold/60 transition-colors" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono">{ride.id.slice(0, 8)}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={statusColor(ride.status)}>{ride.status.replace("_", " ")}</Badge>
            {showDetailHint && <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-gold transition-colors" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Route</div>
          <div className="font-medium">{ride.pickupAddress}</div>
          <div className="text-muted-foreground text-xs">→ {ride.dropAddress}</div>
        </div>
        {ride.driver ? (
          <div className="flex items-center gap-3 p-3 rounded-md bg-secondary">
            <div className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center font-semibold text-xs">{ride.driver.fullName.split(" ").map((n) => n[0]).join("")}</div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{ride.driver.fullName}</div>
              <div className="text-xs text-muted-foreground truncate">{ride.driver.phone}</div>
            </div>
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        ) : (
          <div className="p-3 rounded-md border-2 border-dashed text-center text-xs text-muted-foreground">Awaiting driver…</div>
        )}

        {/* Driver approach badge — assigned but not started */}
        {ride.status === "assigned" && ride.driver && (
          <div className="rounded-lg border border-gold/20 bg-gold/5 px-3 py-2">
            <DriverApproachBadge rideId={ride.id} />
          </div>
        )}

        {/* Live ETA tracker — only for in_progress rides */}
        {ride.status === "in_progress" && (
          <div className="rounded-lg border border-gold/30 bg-gold/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-gold-dark font-semibold mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" /> Live tracking
            </div>
            <LiveRideTracker
              rideId={ride.id}
              rideType={ride.type}
              dropAddress={rideFull?.dropAddress ?? ride.dropAddress}
              dropLat={rideFull?.dropLat}
              dropLng={rideFull?.dropLng}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
          <span>{ride.paxCount} PAX{ride.distanceKm ? ` · ${ride.distanceKm} km` : ""}</span>
          {(ride.totalAmount ?? ride.price) != null && (
            <span className="font-semibold text-foreground">
              ₹{ride.totalAmount ?? ride.price}
              {ride.escortRequired && <span className="text-amber-600 text-[10px] ml-1">(escort)</span>}
            </span>
          )}
        </div>
        {["assigned", "in_progress", "completed"].includes(ride.status) && (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full"><Route className="h-3.5 w-3.5" /> Trip &amp; OTPs</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Trip progress</DialogTitle></DialogHeader>
              <TripProgress rideId={ride.id} type={ride.type} />
            </DialogContent>
          </Dialog>
        )}
        {canCancel && <Button variant="outline" size="sm" className="w-full" onClick={onCancel}>Cancel ride</Button>}
      </CardContent>
    </Card>
  );
}

function AttentionRow({ ride, canRebroadcast, onRebroadcast, onAssign }: { ride: RideRow; canRebroadcast: boolean; onRebroadcast: () => void; onAssign: () => void }) {
  return (
    <Card className="shadow-card border-warning/40 bg-warning/5">
      <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <span className="font-mono text-sm">{ride.id.slice(0, 8)}</span>
            <Badge variant="outline" className={statusColor(ride.status)}>{ride.status}</Badge>
          </div>
          <div className="font-medium">{ride.pickupAddress} → {ride.dropAddress}</div>
          <div className="text-xs text-muted-foreground">{ride.paxCount} PAX{(ride.totalAmount ?? ride.price) != null ? ` · ₹${ride.totalAmount ?? ride.price}` : ""}</div>
        </div>
        <div className="flex items-center justify-end gap-2">
          {canRebroadcast && (
            <Button variant="outline" onClick={onRebroadcast}>
              <Radio className="h-4 w-4" /> Re-broadcast
            </Button>
          )}
          <Button onClick={onAssign} className="bg-gold text-gold-foreground hover:bg-gold/90 shadow-gold">Find &amp; assign driver</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <Card className="shadow-card">
      <CardContent className="py-16 text-center">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}
