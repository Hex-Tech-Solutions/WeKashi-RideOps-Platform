import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveCabMap } from "@/components/LiveCabMap";
import { statusColor } from "@/lib/rideStatus";
import { useAnalyticsOverview, useRides, useVendors, usePayouts, useLiveDriverLocations } from "@/lib/queries";
import { Activity, Car, Users, Clock, IndianRupee, CheckCircle2, Wallet } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function AdminDashboard() {
  const { data: overview } = useAnalyticsOverview();
  const { data: ridesData } = useRides({ limit: 8 });
  const { data: vendorsData } = useVendors();
  const { data: payoutsData } = usePayouts();
  const { data: liveDrivers } = useLiveDriverLocations();
  const cabs = liveDrivers?.drivers ?? [];

  const byStatus = overview?.ridesByStatus ?? {};
  const liveRides = (byStatus.in_progress ?? 0) + (byStatus.assigned ?? 0) + (byStatus.broadcasting ?? 0);
  const pending = byStatus.pending ?? 0;
  const driversOnline = overview?.activeDrivers ?? 0;
  const revenue = overview?.totalRevenue ?? 0;
  const completedRides = byStatus.completed ?? 0;
  const payoutsList = payoutsData?.payouts ?? [];
  const totalPayouts = payoutsList.reduce((s, p) => s + p.amount, 0);

  const rides = ridesData?.rides ?? [];
  const vendors = vendorsData?.vendors ?? [];
  const statusEntries = Object.entries(byStatus);
  const maxStatus = Math.max(1, ...statusEntries.map(([, n]) => n));

  return (
    <div>
      <PageHeader title="Platform Overview" description="Real-time view of all RideOps activity." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Live rides" value={liveRides} hint="In-progress · assigned · broadcasting" icon={Car} />
        <StatCard label="Drivers online" value={driversOnline} hint="Active & online" icon={Users} />
        <StatCard label="Pending bookings" value={pending} accent icon={Clock} />
        <StatCard label="Revenue · completed" value={`₹${(revenue / 1000).toFixed(1)}k`} hint="All completed rides" icon={IndianRupee} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Finished rides" value={completedRides} hint="Completed trips (payable)" icon={CheckCircle2} />
        <StatCard label="Total vendor payouts" value={`₹${totalPayouts.toLocaleString()}`} hint={`${payoutsList.length} payout record${payoutsList.length === 1 ? "" : "s"}`} icon={Wallet} />
        <StatCard label="Vendors" value={vendors.length} hint="Fleet partners" icon={Users} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card className="lg:col-span-2 shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-gold" /> Live cab map</CardTitle>
            <Badge variant="outline" className="border-gold/40 bg-gold-soft text-gold-dark">{cabs.length} online</Badge>
          </CardHeader>
          <CardContent>
            <LiveCabMap drivers={cabs} height={320} />
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Vendors</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {vendors.length === 0 && <div className="text-sm text-muted-foreground">No vendors yet.</div>}
            {vendors.map((v, i) => (
              <div key={v.id} className="flex items-center gap-3 p-3 rounded-md bg-secondary">
                <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{v.name}</div>
                  <div className="text-xs text-muted-foreground">{v._count?.drivers ?? 0} drivers · {v._count?.rides ?? 0} rides</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 shadow-card">
          <CardHeader><CardTitle className="text-base">Rides by status</CardTitle></CardHeader>
          <CardContent>
            {statusEntries.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">No rides yet.</div>
            ) : (
              <div className="flex items-end gap-3 h-48">
                {statusEntries.map(([status, n]) => (
                  <div key={status} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex items-end h-40">
                      <div className="w-full bg-gradient-dark rounded-t-md" style={{ height: `${(n / maxStatus) * 100}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</div>
                    <div className="text-[10px] font-medium">{n}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Recent ride feed</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-72 overflow-auto">
            {rides.length === 0 && <div className="text-sm text-muted-foreground">No rides yet.</div>}
            {rides.slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs p-2 rounded border">
                <span className="font-mono">{r.id.slice(0, 8)}</span>
                <Badge variant="outline" className={statusColor(r.status) + " text-[10px] py-0"}>{r.status.replace("_", " ")}</Badge>
                <span className="ml-auto text-muted-foreground">
                  {r.createdAt ? formatDistanceToNow(new Date(r.createdAt), { addSuffix: true }) : "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
