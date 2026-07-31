import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDrivers, useRides, useUpdateDriverStatus, usePendingDocsCount } from "@/lib/queries";
import { DriverDetailDrawer } from "@/components/DriverDetailDrawer";
import { Search, Ban, RotateCcw, Loader2, AlertTriangle, Eye } from "lucide-react";
import { toast } from "sonner";

export default function Drivers() {
  const { data: driversData, isLoading } = useDrivers();
  const { data: ridesData } = useRides({ limit: 200 });
  const { data: pendingData } = usePendingDocsCount();
  const updateStatus = useUpdateDriverStatus();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "pending" | "blacklisted">("all");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const drivers = driversData?.drivers ?? [];
  const rides = ridesData?.rides ?? [];
  const rideCount = (id: string) => rides.filter((r) => r.driverId === id).length;
  const earnings = (id: string) => rides.filter((r) => r.driverId === id && r.status === "completed").reduce((s, r) => s + (r.price ?? 0), 0);

  const filtered = drivers
    .filter((d) => status === "all" || d.status === status)
    .filter((d) => d.fullName.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q));

  const pendingDocsCount = pendingData?.count ?? 0;

  const statusVariant = (s: string) => {
    if (s === "active")      return "border-success/40 text-success bg-success/10";
    if (s === "blacklisted") return "border-destructive/40 text-destructive bg-destructive/10";
    if (s === "pending")     return "border-warning/40 text-warning bg-warning/10";
    if (s === "expired")     return "border-destructive/40 text-destructive bg-destructive/10";
    return "";
  };

  const setDriver = (id: string, s: "active" | "blacklisted", name: string) =>
    updateStatus.mutate({ id, status: s }, {
      onSuccess: () => (s === "active" ? toast.success(`${name} reinstated`) : toast.error(`${name} blacklisted`)),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });

  return (
    <div>
      <PageHeader
        title="Drivers"
        description="All drivers in your fleet."
        actions={
          pendingDocsCount > 0 ? (
            <Badge className="bg-warning text-warning-foreground text-xs px-2.5 py-1">
              <AlertTriangle className="h-3.5 w-3.5 mr-1" />
              {pendingDocsCount} document{pendingDocsCount !== 1 ? "s" : ""} awaiting approval
            </Badge>
          ) : undefined
        }
      />
      <Card className="shadow-card">
        <CardContent className="p-0">
          {/* Filters */}
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or phone…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {(["all", "active", "pending", "blacklisted"] as const).map((s) => (
                <Button key={s} size="sm" variant={status === s ? "default" : "outline"} className="capitalize" onClick={() => setStatus(s)}>
                  {s}
                </Button>
              ))}
            </div>
            <Badge variant="outline" className="ml-auto">{filtered.length} drivers</Badge>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Driver</th>
                  <th className="text-left font-medium px-6 py-3">DL / Gov ID</th>
                  <th className="text-left font-medium px-6 py-3">Vehicle</th>
                  <th className="text-left font-medium px-6 py-3">KYC / Status</th>
                  <th className="text-left font-medium px-6 py-3">Online</th>
                  <th className="text-right font-medium px-6 py-3">Rides</th>
                  <th className="text-right font-medium px-6 py-3">Rating</th>
                  <th className="text-right font-medium px-6 py-3">Earnings</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={9} className="text-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" />
                    </td>
                  </tr>
                )}
                {filtered.map((d) => (
                  <tr
                    key={d.id}
                    className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                    onClick={() => setSelectedDriverId(d.id)}
                  >
                    {/* Driver */}
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold shrink-0">
                          {d.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-medium">{d.fullName}</div>
                          <div className="text-xs text-muted-foreground">{d.phone}</div>
                          {d.altPhone && (
                            <div className="text-xs text-muted-foreground">{d.altPhone}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* DL / Gov ID */}
                    <td className="px-6 py-3">
                      {d.dlNumber ? (
                        <div>
                          <div className="text-xs font-mono">{d.dlNumber}</div>
                          {d.dlExpiry && (
                            <div className={`text-[10px] ${new Date(d.dlExpiry) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                              DL exp: {new Date(d.dlExpiry).toLocaleDateString("en-IN")}
                            </div>
                          )}
                          {d.govIdNumber && (
                            <div className="text-[10px] text-muted-foreground font-mono">ID: {d.govIdNumber}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Vehicle */}
                    <td className="px-6 py-3">
                      {d.vehicle ? (
                        <>
                          <div className="text-xs">{d.vehicle.fuelType} · {d.vehicle.capacity} seats</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{d.vehicle.regNo}</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No vehicle</span>
                      )}
                    </td>

                    {/* KYC + Status */}
                    <td className="px-6 py-3">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className={statusVariant(d.kycStatus)}>
                          KYC: {d.kycStatus}
                        </Badge>
                        <Badge variant="outline" className={statusVariant(d.status)}>
                          {d.status}
                        </Badge>
                      </div>
                    </td>

                    {/* Online */}
                    <td className="px-6 py-3">
                      {d.isOnline ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-success">
                          <span className="h-2 w-2 rounded-full bg-success" /> Online
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Offline</span>
                      )}
                    </td>

                    <td className="px-6 py-3 text-right">{rideCount(d.id)}</td>
                    <td className="px-6 py-3 text-right">⭐ {d.rating.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right font-medium">₹{earnings(d.id).toLocaleString()}</td>

                    {/* Actions */}
                    <td className="px-6 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => { e.stopPropagation(); setSelectedDriverId(d.id); }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {d.status === "blacklisted" ? (
                          <Button size="sm" variant="outline" disabled={updateStatus.isPending} onClick={() => setDriver(d.id, "active", d.fullName)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Reinstate
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={updateStatus.isPending} onClick={() => setDriver(d.id, "blacklisted", d.fullName)}>
                            <Ban className="h-3.5 w-3.5" /> Blacklist
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                      No drivers match the filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Driver detail drawer */}
      <DriverDetailDrawer
        driverId={selectedDriverId}
        onClose={() => setSelectedDriverId(null)}
        canApprove={true}
      />
    </div>
  );
}
