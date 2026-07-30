import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDrivers, useRides, useUpdateDriverStatus } from "@/lib/queries";
import { Search, Ban, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function Drivers() {
  const { data: driversData, isLoading } = useDrivers();
  const { data: ridesData } = useRides({ limit: 200 });
  const updateStatus = useUpdateDriverStatus();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "pending" | "blacklisted">("all");

  const drivers = driversData?.drivers ?? [];
  const rides = ridesData?.rides ?? [];
  const rideCount = (id: string) => rides.filter((r) => r.driverId === id).length;
  const earnings = (id: string) => rides.filter((r) => r.driverId === id && r.status === "completed").reduce((s, r) => s + (r.price ?? 0), 0);

  const filtered = drivers
    .filter((d) => status === "all" || d.status === status)
    .filter((d) => d.fullName.toLowerCase().includes(q.toLowerCase()));

  const statusVariant = (s: string) => {
    if (s === "active") return "border-success/40 text-success bg-success/10";
    if (s === "blacklisted") return "border-destructive/40 text-destructive bg-destructive/10";
    if (s === "pending") return "border-warning/40 text-warning bg-warning/10";
    return "";
  };

  const setDriver = (id: string, s: "active" | "blacklisted", name: string) =>
    updateStatus.mutate({ id, status: s }, {
      onSuccess: () => (s === "active" ? toast.success(`${name} reinstated`) : toast.error(`${name} blacklisted`)),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });

  return (
    <div>
      <PageHeader title="Drivers" description="All drivers in your fleet." />
      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search drivers…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            <div className="flex items-center gap-1.5">
              {(["all", "active", "pending", "blacklisted"] as const).map((s) => (
                <Button key={s} size="sm" variant={status === s ? "default" : "outline"} className="capitalize" onClick={() => setStatus(s)}>{s}</Button>
              ))}
            </div>
            <Badge variant="outline" className="ml-auto">{filtered.length} drivers</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Driver</th>
                  <th className="text-left font-medium px-6 py-3">Vehicle</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th className="text-left font-medium px-6 py-3">Online</th>
                  <th className="text-right font-medium px-6 py-3">Rides</th>
                  <th className="text-right font-medium px-6 py-3">Rating</th>
                  <th className="text-right font-medium px-6 py-3">Earnings</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={8} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
                )}
                {filtered.map((d) => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold">{d.fullName.split(" ").map((n) => n[0]).join("")}</div>
                        <div>
                          <div className="font-medium">{d.fullName}</div>
                          <div className="text-xs text-muted-foreground">{d.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3">{d.vehicle ? (<><div>{d.vehicle.fuelType} · {d.vehicle.capacity} seats</div><div className="text-xs text-muted-foreground font-mono">{d.vehicle.regNo}</div></>) : <span className="text-xs text-muted-foreground">No vehicle</span>}</td>
                    <td className="px-6 py-3">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className={statusVariant(d.status)}>{d.status}</Badge>
                        {d.kycStatus === "expired" && (
                          <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10 gap-1 w-fit">
                            <AlertTriangle className="h-3 w-3" /> KYC expired
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3">{d.isOnline ? <span className="inline-flex items-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full bg-success" /> Online</span> : <span className="text-xs text-muted-foreground">Offline</span>}</td>
                    <td className="px-6 py-3 text-right">{rideCount(d.id)}</td>
                    <td className="px-6 py-3 text-right">⭐ {d.rating.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right font-medium">₹{earnings(d.id).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right">
                      {d.status === "blacklisted" ? (
                        <Button size="sm" variant="outline" disabled={updateStatus.isPending} onClick={() => setDriver(d.id, "active", d.fullName)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Reinstate
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={updateStatus.isPending} onClick={() => setDriver(d.id, "blacklisted", d.fullName)}>
                          <Ban className="h-3.5 w-3.5" /> Blacklist
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">No drivers match the filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
