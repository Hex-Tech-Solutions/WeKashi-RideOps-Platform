import { useMemo, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDrivers, useUpdateDriverStatus } from "@/lib/queries";
import { Ban, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function AdminDrivers() {
  const { data, isLoading } = useDrivers();
  const updateStatus = useUpdateDriverStatus();
  const [vendor, setVendor] = useState<string>("all");

  const drivers = data?.drivers ?? [];
  const vendorNames = useMemo(
    () => Array.from(new Set(drivers.map((d) => d.vendor?.name).filter(Boolean) as string[])),
    [drivers],
  );
  const list = vendor === "all" ? drivers : drivers.filter((d) => d.vendor?.name === vendor);

  const statusVariant = (s: string) =>
    s === "active" ? "border-success/40 text-success"
    : s === "blacklisted" ? "border-destructive/40 text-destructive"
    : "border-warning/40 text-warning";

  const setStatus = (id: string, status: "active" | "blacklisted", msg: string) => {
    updateStatus.mutate({ id, status }, {
      onSuccess: () => toast.success(msg),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <div>
      <PageHeader title="All Drivers" description="Platform-wide driver registry."
        actions={
          <div className="flex gap-1.5 flex-wrap">
            <Button size="sm" variant={vendor === "all" ? "default" : "outline"} onClick={() => setVendor("all")}>All</Button>
            {vendorNames.map((v) => <Button key={v} size="sm" variant={vendor === v ? "default" : "outline"} onClick={() => setVendor(v)}>{v}</Button>)}
          </div>
        } />
      <Card className="shadow-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                  <tr>
                    <th className="text-left font-medium px-6 py-3">Driver</th>
                    <th className="text-left font-medium px-6 py-3">Vendor</th>
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
                    <tr><td colSpan={8} className="px-6 py-10 text-center text-muted-foreground">No drivers yet.</td></tr>
                  )}
                  {list.map((d) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-6 py-3"><div className="font-medium">{d.fullName}</div><div className="text-xs text-muted-foreground">{d.phone}</div></td>
                      <td className="px-6 py-3">{d.vendor?.name ?? "—"}</td>
                      <td className="px-6 py-3">
                        {d.vehicle ? (
                          <><div className="text-xs">{d.vehicle.fuelType} · {d.vehicle.capacity} seats</div><div className="text-[10px] text-muted-foreground font-mono">{d.vehicle.regNo}</div></>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
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
                      <td className="px-6 py-3"><Badge variant="outline" className={statusVariant(d.status)}>{d.status}</Badge></td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs ${d.isOnline ? "text-success" : "text-muted-foreground"}`}>
                          <span className={`h-2 w-2 rounded-full ${d.isOnline ? "bg-success" : "bg-muted-foreground/40"}`} />
                          {d.isOnline ? "online" : "offline"}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">{d.rating.toFixed(1)}</td>
                      <td className="px-6 py-3 text-right">
                        {d.status === "blacklisted" ? (
                          <Button size="sm" variant="outline" disabled={updateStatus.isPending} onClick={() => setStatus(d.id, "active", "Reinstated")}><RotateCcw className="h-3.5 w-3.5" /></Button>
                        ) : (
                          <Button size="sm" variant="ghost" className="hover:text-destructive" disabled={updateStatus.isPending} onClick={() => setStatus(d.id, "blacklisted", "Blacklisted")}><Ban className="h-3.5 w-3.5" /></Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
