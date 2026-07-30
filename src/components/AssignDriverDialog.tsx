import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useNearbyDrivers, useAssignRide } from "@/lib/queries";
import { Loader2, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";

export function AssignDriverDialog({ rideId, open, onOpenChange }: { rideId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [radius, setRadius] = useState(5);
  const [price, setPrice] = useState("");
  const { data, isLoading } = useNearbyDrivers(rideId, radius, open);
  const assign = useAssignRide();
  const drivers = data?.drivers ?? [];

  const doAssign = (driverId: string) => {
    if (!rideId) return;
    const p = price ? Number(price) : undefined;
    assign.mutate({ rideId, driverId, price: p }, {
      onSuccess: () => { toast.success("Ride assigned to driver"); onOpenChange(false); setPrice(""); },
      onError: (e: any) => toast.error(e?.message ?? "Failed to assign"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Find & assign a driver</DialogTitle></DialogHeader>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {[5, 10].map((r) => (
              <Button key={r} size="sm" variant={radius === r ? "default" : "outline"} onClick={() => setRadius(r)}>{r} km</Button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Label className="text-xs whitespace-nowrap">Adjust price ₹</Label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="h-8 w-24" placeholder="optional" />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-2 mt-1">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : drivers.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">No active drivers with a location within {radius} km.</div>
          ) : (
            drivers.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded border text-sm">
                <div className="h-9 w-9 rounded-full bg-foreground text-background flex items-center justify-center text-xs font-semibold">{d.fullName.split(" ").map((n) => n[0]).join("")}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex items-center gap-2">
                    {d.fullName}
                    <span className={`inline-flex items-center gap-1 text-[10px] ${d.isOnline ? "text-success" : "text-muted-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${d.isOnline ? "bg-success" : "bg-muted-foreground/40"}`} />{d.isOnline ? "online" : "offline"}</span>
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{d.distanceKm} km</span>
                    <span>⭐ {d.rating.toFixed(1)}</span>
                    {d.vehicleType && <span className="capitalize">{d.vehicleType}{d.regNo ? ` · ${d.regNo}` : ""}</span>}
                  </div>
                </div>
                <a href={`tel:${d.phone}`} className="text-muted-foreground hover:text-foreground"><Phone className="h-4 w-4" /></a>
                <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90" disabled={assign.isPending} onClick={() => doAssign(d.id)}>Assign</Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
