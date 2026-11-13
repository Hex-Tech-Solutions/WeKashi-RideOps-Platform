import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDrivers, useUpdateDriverStatus, type DriverRow } from "@/lib/queries";
import { Check, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

/**
 * Driver Approvals — ACCOUNT approval only.
 *
 * A vendor approves or rejects a new driver's account here. KYC and documents
 * are reviewed separately in the driver detail drawer, so they are not shown
 * on this page. One horizontal row per driver.
 */
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
        description="Approve new driver accounts. Documents and KYC are reviewed from the driver's details."
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
        <Card className="shadow-card overflow-hidden">
          {/* Column headings — wide screens only */}
          <div className="hidden md:grid grid-cols-[2fr_1.3fr_1.3fr_1fr_0.9fr_1.6fr] gap-4 px-5 py-3 border-b bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground font-medium">
            <div>Driver</div>
            <div>Phone</div>
            <div>Vehicle No.</div>
            <div>Signed up</div>
            <div>Status</div>
            <div className="text-right">Actions</div>
          </div>

          <ul className="divide-y">
            {list.map((d) => (
              <ApprovalRow
                key={d.id}
                driver={d}
                busy={updateStatus.isPending}
                onApprove={() => act(d.id, "active", d.fullName)}
                onReject={() => act(d.id, "blacklisted", d.fullName)}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function statusClass(status: DriverRow["status"]) {
  if (status === "active") return "border-success/40 text-success";
  if (status === "blacklisted" || status === "expired") return "border-destructive/40 text-destructive";
  return "border-warning/40 text-warning";
}

function ApprovalRow({
  driver: d,
  busy,
  onApprove,
  onReject,
}: {
  driver: DriverRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const initials = d.fullName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const regNo = d.vehicle?.regNo ?? "—";
  const signedUp = format(new Date(d.createdAt), "dd MMM yyyy");

  return (
    <li className="px-5 py-3 grid grid-cols-1 md:grid-cols-[2fr_1.3fr_1.3fr_1fr_0.9fr_1.6fr] gap-2 md:gap-4 md:items-center text-sm">
      {/* Driver */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden="true">
          {initials}
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">{d.fullName}</div>
          {/* On narrow screens, phone · vehicle · date sit under the name */}
          <div className="md:hidden text-xs text-muted-foreground truncate">
            {d.phone} · <span className="font-mono">{regNo}</span> · {signedUp}
          </div>
        </div>
        <Badge variant="outline" className={`md:hidden ml-auto capitalize ${statusClass(d.status)}`}>{d.status}</Badge>
      </div>

      <div className="hidden md:block text-muted-foreground">{d.phone}</div>
      <div className="hidden md:block font-mono text-xs">{regNo}</div>
      <div className="hidden md:block text-muted-foreground">{signedUp}</div>
      <div className="hidden md:block">
        <Badge variant="outline" className={`capitalize ${statusClass(d.status)}`}>{d.status}</Badge>
      </div>

      {/* Actions */}
      <div className="flex md:justify-end gap-2">
        {d.status === "pending" ? (
          <>
            <Button size="sm" disabled={busy} onClick={onApprove} className="flex-1 md:flex-none bg-foreground text-background hover:bg-foreground/90" aria-label={`Approve ${d.fullName}`}>
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button size="sm" disabled={busy} onClick={onReject} variant="outline" className="flex-1 md:flex-none hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40" aria-label={`Reject ${d.fullName}`}>
              <X className="h-4 w-4" /> Reject
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
    </li>
  );
}
