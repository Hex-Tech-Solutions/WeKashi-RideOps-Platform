import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDrivers, useUpdateDriverStatus, useDriverDocsForVendor, useSetDocumentStatus, fileSrc } from "@/lib/queries";
import { Check, X, Loader2, FileText, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function Approvals() {
  const { data, isLoading } = useDrivers();
  const updateStatus = useUpdateDriverStatus();
  const drivers = data?.drivers ?? [];
  const pending = drivers.filter((d) => d.status === "pending");
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const list = filter === "pending" ? pending : drivers;

  const act = (id: string, status: "active" | "blacklisted", name: string) =>
    updateStatus.mutate({ id, status }, {
      onSuccess: () => (status === "active" ? toast.success(`${name} approved`) : toast.error(`${name} rejected`)),
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });

  return (
    <div>
      <PageHeader
        title="Driver Approvals"
        description="Activate new drivers once their details are verified."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant={filter === "pending" ? "default" : "outline"} onClick={() => setFilter("pending")}>Pending ({pending.length})</Button>
            <Button size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => setFilter("all")}>All ({drivers.length})</Button>
          </div>
        }
      />

      {isLoading ? (
        <Card className="shadow-card"><CardContent className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></CardContent></Card>
      ) : list.length === 0 ? (
        <Card className="shadow-card"><CardContent className="py-16 text-center text-sm text-muted-foreground">No drivers awaiting review 🎉</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {list.map((d) => (
            <Card key={d.id} className="shadow-card">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-foreground text-background flex items-center justify-center font-semibold">{d.fullName.split(" ").map((n) => n[0]).join("")}</div>
                    <div>
                      <CardTitle className="text-base">{d.fullName}</CardTitle>
                      <div className="text-xs text-muted-foreground mt-1">{d.phone}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className={
                    d.status === "active" ? "border-success/40 text-success" :
                    d.status === "blacklisted" ? "border-destructive/40 text-destructive" :
                    "border-warning/40 text-warning"
                  }>{d.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm p-3 bg-secondary rounded-md">
                  <div><div className="text-xs text-muted-foreground">Vehicle</div><div className="font-medium">{d.vehicle ? `${d.vehicle.fuelType} · ${d.vehicle.capacity} seats` : "Not assigned"}</div></div>
                  <div><div className="text-xs text-muted-foreground">Reg No.</div><div className="font-mono text-xs">{d.vehicle?.regNo ?? "—"}</div></div>
                  <div><div className="text-xs text-muted-foreground">KYC</div><div className="font-medium capitalize">{d.kycStatus}</div></div>
                  <div><div className="text-xs text-muted-foreground">Rating</div><div className="font-medium">⭐ {d.rating.toFixed(1)}</div></div>
                </div>

                <DriverDocList driverId={d.id} />

                {d.status === "pending" && (
                  <div className="flex gap-2 pt-2">
                    <Button disabled={updateStatus.isPending} onClick={() => act(d.id, "active", d.fullName)} className="flex-1 bg-foreground text-background hover:bg-foreground/90"><Check className="h-4 w-4" /> Approve</Button>
                    <Button disabled={updateStatus.isPending} onClick={() => act(d.id, "blacklisted", d.fullName)} variant="outline" className="flex-1 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40"><X className="h-4 w-4" /> Reject</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DriverDocList({ driverId }: { driverId: string }) {
  const { data, isLoading } = useDriverDocsForVendor(driverId);
  const setStatus = useSetDocumentStatus();
  const docs = data?.documents ?? [];

  if (isLoading) return <div className="py-2"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Documents ({docs.length})</div>
      {docs.length === 0 && <div className="text-xs text-muted-foreground">No documents uploaded yet.</div>}
      {docs.map((doc) => (
        <div key={doc.id} className="flex items-center gap-2 p-2 rounded border text-sm">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="capitalize truncate">{doc.type}{doc.number ? ` · #${doc.number}` : ""}</div>
            {doc.expiry && <div className="text-[10px] text-muted-foreground">exp {doc.expiry.slice(0, 10)}</div>}
          </div>
          <Badge variant="outline" className={
            doc.status === "verified" ? "border-success/40 text-success"
            : doc.status === "rejected" ? "border-destructive/40 text-destructive"
            : "border-warning/40 text-warning"
          }>{doc.status}</Badge>
          <a href={fileSrc(doc.fileUrl)} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>
          {doc.status !== "verified" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-success" disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ driverId, docId: doc.id, status: "verified" }, { onSuccess: () => toast.success("Verified"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}>
              Verify
            </Button>
          )}
          {doc.status !== "rejected" && (
            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={setStatus.isPending}
              onClick={() => setStatus.mutate({ driverId, docId: doc.id, status: "rejected" }, { onSuccess: () => toast("Rejected"), onError: (e: any) => toast.error(e?.message ?? "Failed") })}>
              Reject
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
