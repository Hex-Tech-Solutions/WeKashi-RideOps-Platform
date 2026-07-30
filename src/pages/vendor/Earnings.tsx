import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDrivers, useRides, usePayouts } from "@/lib/queries";
import { FileText } from "lucide-react";

export default function Earnings() {
  const { data: driversData } = useDrivers();
  const { data: ridesData } = useRides({ limit: 200 });
  const { data: payoutsData } = usePayouts();

  const drivers = driversData?.drivers ?? [];
  const rides = ridesData?.rides ?? [];
  const payouts = payoutsData?.payouts ?? [];
  const completed = rides.filter((r) => r.status === "completed");
  const total = completed.reduce((s, r) => s + (r.price ?? 0), 0);
  const paidOut = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  const earningsFor = (id: string) => completed.filter((r) => r.driverId === id).reduce((s, r) => s + (r.price ?? 0), 0);

  return (
    <div>
      <PageHeader title="Earnings" description="Driver-level earnings from completed rides." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total earnings" value={`₹${(total / 1000).toFixed(1)}k`} accent />
        <StatCard label="Completed" value={completed.length} hint="Rides finished" />
        <StatCard label="Paid out" value={`₹${(paidOut / 1000).toFixed(1)}k`} hint="Settled by admin" />
        <StatCard label="Payout records" value={payouts.length} />
      </div>

      <Card className="shadow-card mb-6">
        <CardHeader><CardTitle className="text-base">Payouts from admin</CardTitle></CardHeader>
        <CardContent className="p-0">
          {payouts.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">No payouts yet. When the admin settles a payout, it appears here with any proof file.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Period</th>
                  <th className="text-right font-medium px-6 py-3">Amount</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Paid on</th>
                  <th className="text-left font-medium px-6 py-3">Proof</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-6 py-3 font-medium">{p.period}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="font-bold">₹{p.amount.toLocaleString()}</div>
                      {p.ratePerRide != null && <div className="text-[11px] text-muted-foreground">₹{p.ratePerRide}/ride × {p.rideCount ?? Math.round(p.amount / p.ratePerRide)}</div>}
                    </td>
                    <td className="px-6 py-3"><Badge variant="outline" className={p.status === "paid" ? "border-success/40 text-success" : "border-warning/40 text-warning"}>{p.status}</Badge></td>
                    <td className="px-6 py-3 text-muted-foreground">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : "—"}</td>
                    <td className="px-6 py-3">
                      {p.fileUrl ? (
                        <a href={p.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gold hover:underline text-xs"><FileText className="h-3.5 w-3.5" /> View proof</a>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Earnings by driver</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {drivers.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">No drivers yet.</div>}
            {drivers.map((d) => (
              <div key={d.id} className="flex items-center justify-between p-3 rounded-md bg-secondary text-sm">
                <div>
                  <div className="font-medium">{d.fullName}</div>
                  <div className="text-xs text-muted-foreground">{completed.filter((r) => r.driverId === d.id).length} completed</div>
                </div>
                <span className="font-semibold">₹{earningsFor(d.id).toLocaleString()}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Recent completed rides</CardTitle></CardHeader>
          <CardContent>
            {completed.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">No completed rides yet. Earnings appear as rides finish.</div>
            ) : (
              <div className="space-y-2">
                {completed.slice(0, 10).map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-3 rounded-md bg-secondary text-sm">
                    <div>
                      <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                      <span className="text-muted-foreground ml-2">{r.pickupAddress} → {r.dropAddress}</span>
                    </div>
                    <span className="font-semibold">₹{r.price ?? 0}</span>
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
