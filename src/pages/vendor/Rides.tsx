import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { statusColor } from "@/lib/rideStatus";
import { useRides } from "@/lib/queries";
import { Loader2 } from "lucide-react";

export default function VendorRides() {
  const { data, isLoading } = useRides({ limit: 100 });
  const vendorRides = data?.rides ?? [];

  return (
    <div>
      <PageHeader title="Ride History" description="Rides handled by your drivers. Employee details are hidden by design." />
      <Card className="shadow-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Ride</th>
                  <th className="text-left font-medium px-6 py-3">Driver</th>
                  <th className="text-left font-medium px-6 py-3">Route</th>
                  <th className="text-left font-medium px-6 py-3">Booked by</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-right font-medium px-6 py-3">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {vendorRides.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-foreground">No rides yet.</td></tr>
                )}
                {vendorRides.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-3"><div className="font-mono text-xs">{r.id.slice(0, 8)}</div><div className="text-xs text-muted-foreground capitalize mt-0.5">{r.type}</div></td>
                    <td className="px-6 py-3"><div className="font-medium">{r.driver?.fullName ?? "—"}</div><div className="text-xs text-muted-foreground">{r.driver?.phone ?? ""}</div></td>
                    <td className="px-6 py-3 text-muted-foreground">{r.pickupAddress} → {r.dropAddress}</td>
                    <td className="px-6 py-3"><div className="font-medium">{r.supervisor?.fullName ?? "—"}</div></td>
                    <td className="px-6 py-3"><Badge variant="outline" className={statusColor(r.status)}>{r.status.replace("_", " ")}</Badge></td>
                    <td className="px-6 py-3 text-right font-medium">{r.price != null ? `₹${r.price}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
