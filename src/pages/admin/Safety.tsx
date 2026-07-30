import { PageHeader, StatCard } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useIncidents, useUpdateIncidentStatus } from "@/lib/queries";
import { Shield, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

const statusColor = (s: string) =>
  s === "resolved" || s === "closed" ? "border-success/40 text-success"
  : s === "investigating" ? "border-warning/40 text-warning"
  : "border-destructive/40 text-destructive";

export default function Safety() {
  const { data, isLoading } = useIncidents();
  const update = useUpdateIncidentStatus();
  const incidents = data?.incidents ?? [];
  const open = incidents.filter((i) => i.status === "open").length;
  const investigating = incidents.filter((i) => i.status === "investigating").length;
  const resolved = incidents.filter((i) => i.status === "resolved" || i.status === "closed").length;

  return (
    <div>
      <PageHeader title="Safety & Incidents" description="Reported incidents and their resolution status." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Open" value={open} accent />
        <StatCard label="Investigating" value={investigating} />
        <StatCard label="Resolved" value={resolved} />
        <StatCard label="Total" value={incidents.length} />
      </div>
      <Card className="shadow-card">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4 text-gold" /> Incidents</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : incidents.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-10">No incidents reported. All clear. 🎉</div>
          ) : (
            incidents.map((i) => (
              <div key={i.id} className="p-4 rounded border text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{i.id.slice(0, 8)} · ride {i.rideId.slice(0, 8)}</span>
                  <Badge variant="outline" className={statusColor(i.status)}>{i.status}</Badge>
                </div>
                <div className="mt-2">{i.description}</div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(i.createdAt), { addSuffix: true })}</span>
                  <div className="flex gap-1.5">
                    {(["investigating", "resolved", "closed"] as const).filter((s) => s !== i.status).map((s) => (
                      <Button key={s} size="sm" variant="outline" className="h-7 text-xs capitalize" disabled={update.isPending}
                        onClick={() => update.mutate({ id: i.id, status: s }, { onSuccess: () => toast.success(`Marked ${s}`), onError: (e: any) => toast.error(e?.message ?? "Failed") })}>
                        {s}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
