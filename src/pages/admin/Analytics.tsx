import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnalyticsOverview, useRideAnalytics } from "@/lib/queries";

export default function Analytics() {
  const { data: overview } = useAnalyticsOverview();
  const { data: rideStats } = useRideAnalytics();

  const byStatus = Object.entries(rideStats?.byStatus ?? {});
  const byType = Object.entries(rideStats?.byType ?? {});
  const maxStatus = Math.max(1, ...byStatus.map(([, n]) => n));
  const maxType = Math.max(1, ...byType.map(([, n]) => n));

  return (
    <div>
      <PageHeader title="Analytics" description="Platform performance metrics from live data." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total rides" value={overview?.totalRides ?? 0} />
        <StatCard label="Revenue · completed" value={`₹${((overview?.totalRevenue ?? 0) / 1000).toFixed(1)}k`} accent />
        <StatCard label="Avg ride price" value={`₹${Math.round(rideStats?.averagePrice ?? 0)}`} />
        <StatCard label="Completed rides" value={rideStats?.completedCount ?? 0} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Rides by status</CardTitle></CardHeader>
          <CardContent>
            {byStatus.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">No rides yet.</div>
            ) : (
              <div className="flex items-end gap-3 h-56">
                {byStatus.map(([status, n]) => (
                  <div key={status} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex items-end h-44"><div className="w-full bg-foreground rounded-t-md" style={{ height: `${(n / maxStatus) * 100}%` }} /></div>
                    <div className="text-xs text-muted-foreground capitalize">{status.replace("_", " ")}</div>
                    <div className="text-[10px] font-medium">{n}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Rides by type</CardTitle></CardHeader>
          <CardContent>
            {byType.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">No rides yet.</div>
            ) : (
              <div className="flex items-end gap-3 h-56">
                {byType.map(([type, n]) => (
                  <div key={type} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full flex items-end h-44"><div className="w-full bg-gradient-gold rounded-t-md" style={{ height: `${(n / maxType) * 100}%` }} /></div>
                    <div className="text-xs text-muted-foreground capitalize">{type}</div>
                    <div className="text-[10px] font-medium">{n}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
