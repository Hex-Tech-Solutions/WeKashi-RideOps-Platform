import { useMemo, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDrivers, useUpdateDriverStatus } from "@/lib/queries";
import { DriverDetailDrawer } from "@/components/DriverDetailDrawer";
import { Ban, RotateCcw, Loader2, AlertTriangle, Search, Eye } from "lucide-react";
import { toast } from "sonner";

export default function AdminDrivers() {
  const { data, isLoading } = useDrivers();
  const updateStatus = useUpdateDriverStatus();
  const [vendor, setVendor] = useState<string>("all");
  const [q, setQ] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  const drivers = data?.drivers ?? [];
  const vendorNames = useMemo(
    () => Array.from(new Set(drivers.map((d) => d.vendor?.name).filter(Boolean) as string[])),
    [drivers],
  );

  const list = drivers
    .filter((d) => vendor === "all" || d.vendor?.name === vendor)
    .filter((d) => d.fullName.toLowerCase().includes(q.toLowerCase()) || d.phone.includes(q));

  const statusVariant = (s: string) =>
    s === "active"      ? "border-success/40 text-success"
    : s === "blacklisted" ? "border-destructive/40 text-destructive"
    : s === "expired"     ? "border-destructive/40 text-destructive"
    : "border-warning/40 text-warning";

  const setStatus = (id: string, status: "active" | "blacklisted", msg: string) => {
    updateStatus.mutate({ id, status }, {
      onSuccess: () => toast.success(msg),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <div>
      <PageHeader
        title="All Drivers"
        description="Platform-wide driver registry."
        actions={
          <div className="flex gap-1.5 flex-wrap items-center">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9 h-8 w-48"
              />
            </div>
            <Button size="sm" variant={vendor === "all" ? "default" : "outline"} onClick={() => setVendor("all")}>All</Button>
            {vendorNames.map((v) => (
              <Button key={v} size="sm" variant={vendor === v ? "default" : "outline"} onClick={() => setVendor(v)}>
                {v}
              </Button>
            ))}
          </div>
        }
      />
      <Card className="shadow-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-gold" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-6 py-3">Driver</th>
                    <th className="text-left font-medium px-6 py-3">Vendor</th>
                    <th className="text-left font-medium px-6 py-3">DL / Gov ID</th>
                    <th className="text-left font-medium px-6 py-3">Vehicle</th>
                    <th className="text-left font-medium px-6 py-3">KYC</th>
                    <th className="text-left font-medium px-6 py-3">Status</th>
                    <th className="text-left font-medium px-6 py-3">Online</th>
                    <th className="text-right font-medium px-6 py-3">Rating</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-10 text-center text-muted-foreground">
                        No drivers yet.
                      </td>
                    </tr>
                  )}
                  {list.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b last:border-0 hover:bg-muted/40 cursor-pointer"
                      onClick={() => setSelectedDriverId(d.id)}
                    >
                      {/* Driver */}
                      <td className="px-6 py-3">
                        <div className="font-medium">{d.fullName}</div>
                        <div className="text-xs text-muted-foreground">{d.phone}</div>
                        {d.altPhone && <div className="text-xs text-muted-foreground">{d.altPhone}</div>}
                      </td>

                      {/* Vendor */}
                      <td className="px-6 py-3">{d.vendor?.name ?? "—"}</td>

                      {/* DL / Gov ID */}
                      <td className="px-6 py-3">
                        {d.dlNumber ? (
                          <div>
                            <div className="text-xs font-mono">{d.dlNumber}</div>
                            {d.dlExpiry && (
                              <div className={`text-[10px] ${new Date(d.dlExpiry) < new Date() ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                                exp: {new Date(d.dlExpiry).toLocaleDateString("en-IN")}
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
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* KYC */}
                      <td className="px-6 py-3">
                        {d.kycStatus === "expired" ? (
                          <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10 gap-1">
                            <AlertTriangle className="h-3 w-3" /> KYC expired
                          </Badge>
                        ) : (
                          <Badge variant="outline" className={statusVariant(d.kycStatus === "approved" ? "active" : d.kycStatus === "rejected" ? "blacklisted" : "pending")}>
                            {d.kycStatus}
                          </Badge>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-3">
                        <Badge variant="outline" className={statusVariant(d.status)}>{d.status}</Badge>
                      </td>

                      {/* Online */}
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs ${d.isOnline ? "text-success" : "text-muted-foreground"}`}>
                          <span className={`h-2 w-2 rounded-full ${d.isOnline ? "bg-success" : "bg-muted-foreground/40"}`} />
                          {d.isOnline ? "online" : "offline"}
                        </span>
                      </td>

                      <td className="px-6 py-3 text-right">{d.rating.toFixed(1)}</td>

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
                            <Button size="sm" variant="outline" disabled={updateStatus.isPending} onClick={(e) => { e.stopPropagation(); setStatus(d.id, "active", "Reinstated"); }}>
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={updateStatus.isPending} onClick={(e) => { e.stopPropagation(); setStatus(d.id, "blacklisted", "Blacklisted"); }}>
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
