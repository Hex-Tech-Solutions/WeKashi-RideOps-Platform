import { useMemo, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useRides, useCreateIssue } from "@/lib/queries";
import { IssuesList } from "@/components/IssuesList";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export default function SupervisorIssues() {
  const { data: ridesData } = useRides({ limit: 200 });
  const createIssue = useCreateIssue();
  const [rideId, setRideId] = useState("");
  const [description, setDescription] = useState("");

  // Rides that actually had a driver (something to raise an issue about)
  const rides = useMemo(
    () => (ridesData?.rides ?? []).filter((r) => r.driverId && r.driver?.fullName),
    [ridesData],
  );
  const selected = rides.find((r) => r.id === rideId);

  const submit = () => {
    if (!rideId) { toast.error("Select a ride"); return; }
    if (description.trim().length < 5) { toast.error("Describe the issue (min 5 chars)"); return; }
    createIssue.mutate({ rideId, description: description.trim() }, {
      onSuccess: () => { toast.success("Issue raised to vendor & admin"); setDescription(""); setRideId(""); },
      onError: (e: any) => toast.error(e?.message ?? "Failed"),
    });
  };

  return (
    <div>
      <PageHeader title="Issues" description="Pick a ride — the driver & ride details are pulled automatically. Sent to the vendor and admin." />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="shadow-card lg:col-span-1 h-fit">
          <CardHeader><CardTitle className="text-base">Raise an issue</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Ride</Label>
              <Select value={rideId} onValueChange={setRideId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={rides.length ? "Select a ride" : "No rides with a driver yet"} /></SelectTrigger>
                <SelectContent>
                  {rides.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.id.slice(0, 8)} · {r.driver?.fullName} · {r.pickupAddress} → {r.dropAddress}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selected && (
              <div className="rounded-md bg-secondary p-3 space-y-1.5 text-sm">
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Driver</span><span className="font-medium">{selected.driver?.fullName}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Driver phone</span><span className="font-medium">{selected.driver?.phone ?? "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Route</span><span className="font-medium text-right">{selected.pickupAddress} → {selected.dropAddress}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Type / PAX</span><span className="font-medium capitalize">{selected.type} · {selected.paxCount}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Distance / Fare</span><span className="font-medium">{selected.distanceKm ?? "—"} km · {selected.price != null ? `₹${selected.price}` : "—"}</span></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline" className="capitalize">{selected.status.replace("_", " ")}</Badge></div>
                <div className="flex items-center justify-between"><span className="text-muted-foreground">When</span><span className="font-medium">{formatDistanceToNow(new Date(selected.createdAt), { addSuffix: true })}</span></div>
              </div>
            )}

            <div>
              <Label>Describe the issue</Label>
              <Textarea className="mt-1" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Driver was late / rash driving / route deviation…" />
            </div>
            <Button className="w-full bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={createIssue.isPending}>
              {createIssue.isPending ? "Sending…" : "Raise issue"}
            </Button>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <IssuesList canResolve />
        </div>
      </div>
    </div>
  );
}
