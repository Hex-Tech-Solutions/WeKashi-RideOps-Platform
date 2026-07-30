import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDrivers, useRides } from "@/lib/queries";
import { useAuth } from "@/hooks/useAuth";
import { CheckCircle2, Users, Radio, FileCheck, Wallet } from "lucide-react";

export default function VendorDashboard() {
  const { profile } = useAuth();
  const { data: driversData } = useDrivers();
  const { data: ridesData } = useRides({ limit: 200 });

  const drivers = driversData?.drivers ?? [];
  const rides = ridesData?.rides ?? [];
  const active = drivers.filter((d) => d.status === "active").length;
  const online = drivers.filter((d) => d.isOnline).length;
  const pendingKyc = drivers.filter((d) => d.kycStatus === "pending" || d.status === "pending").length;

  const earnings = (id: string) => rides.filter((r) => r.driverId === id && r.status === "completed").reduce((s, r) => s + (r.price ?? 0), 0);
  const rideCount = (id: string) => rides.filter((r) => r.driverId === id).length;
  const totalEarnings = drivers.reduce((s, d) => s + earnings(d.id), 0);
  const top = [...drivers].sort((a, b) => earnings(b.id) - earnings(a.id)).slice(0, 4);

  return (
    <div>
      <PageHeader title="Fleet overview" description={`${profile?.full_name ?? "Your fleet"} · operational health at a glance.`} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Active drivers" value={active} hint={`of ${drivers.length} total`} icon={Users} />
        <StatCard label="Online now" value={online} hint="Available for rides" icon={Radio} />
        <StatCard label="Pending approval" value={pendingKyc} accent icon={FileCheck} />
        <StatCard label="Earnings · completed" value={`₹${(totalEarnings / 1000).toFixed(1)}k`} icon={Wallet} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-gold" /> Fleet status</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Total drivers" value={drivers.length} />
            <Row label="Active" value={active} />
            <Row label="Online now" value={online} />
            <Row label="Pending approval" value={pendingKyc} />
            <Row label="Blacklisted" value={drivers.filter((d) => d.status === "blacklisted").length} />
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success" /> Top performers</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {top.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No drivers yet.</div>}
            {top.map((d, i) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-md bg-secondary text-sm">
                <div className="h-8 w-8 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-bold">{i + 1}</div>
                <div className="flex-1">
                  <div className="font-medium">{d.fullName}</div>
                  <div className="text-xs text-muted-foreground">{rideCount(d.id)} rides · ⭐ {d.rating.toFixed(1)}</div>
                </div>
                <div className="font-semibold">₹{earnings(d.id).toLocaleString()}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}
