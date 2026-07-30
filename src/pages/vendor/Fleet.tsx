import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useDrivers, useCreateDriver } from "@/lib/queries";
import { Car, Fuel, Users, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Fleet() {
  const { data, isLoading } = useDrivers();
  const createDriver = useCreateDriver();
  const drivers = data?.drivers ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "+91" });

  const submit = () => {
    const digits = form.phone.replace(/[^\d]/g, "");
    if (!form.name) { toast.error("Driver name is required"); return; }
    if (digits.length < 10) { toast.error("Enter a valid phone number"); return; }
    createDriver.mutate({ fullName: form.name, phone: digits }, {
      onSuccess: () => {
        toast.success(`${form.name} added · awaiting approval`);
        setOpen(false);
        setForm({ name: "", phone: "+91" });
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
                <div className="font-bold">{d.vehicle ? `${d.vehicle.fuelType} vehicle` : "No vehicle assigned"}</div>
                <div className="text-xs text-muted-foreground font-mono mt-1">{d.vehicle?.regNo ?? "—"}</div>
                <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                  <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-muted-foreground" /> {d.vehicle?.capacity ?? "—"} seater</div>
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
            <div><Label>Phone</Label><Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98xxxxxxxx" /></div>
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
