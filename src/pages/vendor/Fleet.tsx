import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useDrivers, useCreateDriver } from "@/lib/queries";
import { PhoneInput, toE164, isValidMobile } from "@/components/PhoneInput";
import { Car, Fuel, Users, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Fleet() {
  const { data, isLoading } = useDrivers();
  const createDriver = useCreateDriver();
  const drivers = data?.drivers ?? [];
  const [open, setOpen] = useState(false);
  // phone = the 10 mobile digits only; "+91" is fixed in the input.
  const [form, setForm] = useState({ name: "", phone: "" });

  const submit = () => {
    if (form.name.trim().length < 2) { toast.error("Driver name is required"); return; }
    if (!isValidMobile(form.phone)) { toast.error("Enter a valid 10-digit mobile number"); return; }
    createDriver.mutate({ fullName: form.name.trim(), phone: toE164(form.phone) }, {
      onSuccess: () => {
        toast.success(`${form.name} added · awaiting approval`);
        setOpen(false);
        setForm({ name: "", phone: "" });
      },
      onError: (e: any) => toast.error(e?.message ?? "Could not add driver"),
    });
  };

  return (
    <div>
      <PageHeader title="Fleet" description="Drivers and vehicles registered to your fleet." actions={
        <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add driver</Button>
      } />
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : drivers.length === 0 ? (
        <Card className="shadow-card"><CardContent className="py-16 text-center text-sm text-muted-foreground">No drivers yet — add your first one.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {drivers.map((d) => (
            <Card key={d.id} className="shadow-card hover:border-gold transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-md bg-foreground text-background flex items-center justify-center"><Car className="h-5 w-5" /></div>
                  <Badge variant="outline" className={d.status === "active" ? "border-success/40 text-success" : d.status === "blacklisted" ? "border-destructive/40 text-destructive" : "border-warning/40 text-warning"}>{d.status}</Badge>
                </div>
                <div className="font-bold capitalize">
                  {d.vehicle || d.vehicleType
                    ? `${d.vehicleType ?? d.vehicle?.fuelType ?? "Vehicle"}${d.vehicleType && d.vehicle?.fuelType ? ` · ${d.vehicle.fuelType}` : ""}`
                    : "No vehicle added"}
                </div>
                <div className="text-xs text-muted-foreground font-mono mt-1">{d.vehicle?.regNo ?? "—"}</div>
                <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                  <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-muted-foreground" /> {d.vehicle?.capacity ?? d.seats ?? "—"} seater</div>
                  <div className="flex items-center gap-1.5"><Fuel className="h-3.5 w-3.5 text-muted-foreground" /> {d.vehicle?.fuelType ?? "—"}</div>
                </div>
                <div className="border-t mt-4 pt-3 text-xs text-muted-foreground">Driver: <span className="text-foreground font-medium">{d.fullName}</span> · {d.isOnline ? "online" : "offline"}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add driver</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2">
            <div><Label>Driver name</Label><Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="add-driver-phone">Phone</Label><PhoneInput id="add-driver-phone" className="mt-1" value={form.phone} onChange={(phone) => setForm({ ...form, phone })} /></div>
            <div className="text-xs text-muted-foreground">The driver signs in on the mobile app with this phone (OTP). Vehicle &amp; document assignment is coming soon.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={createDriver.isPending}>{createDriver.isPending ? "Adding…" : "Add driver"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
