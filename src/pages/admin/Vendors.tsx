import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useVendors, useCreateVendorAccount } from "@/lib/queries";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

export default function Vendors() {
  const { data, isLoading } = useVendors();
  const createVendor = useCreateVendorAccount();
  const vendors = data?.vendors ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ company: "", contactName: "", contactEmail: "", contactPhone: "", email: "", password: "" });

  const submit = () => {
    const digits = form.contactPhone.replace(/[^\d]/g, "");
    if (!form.company || !form.contactName || !form.contactEmail || !form.email || form.password.length < 8) {
      toast.error("All fields required · password ≥ 8 chars"); return;
    }
    if (digits.length < 10) { toast.error("Enter a valid contact phone"); return; }
    createVendor.mutate({ ...form, contactPhone: digits }, {
      onSuccess: () => { toast.success(`Vendor ${form.company} created`); setOpen(false); setForm({ company: "", contactName: "", contactEmail: "", contactPhone: "", email: "", password: "" }); },
      onError: (e: any) => toast.error(e?.message ?? "Could not create vendor"),
    });
  };

  return (
    <div>
      <PageHeader title="Vendors" description="All onboarded fleet partners."
        actions={<Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New vendor</Button>} />
      <Card className="shadow-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Vendor</th>
                  <th className="text-left font-medium px-6 py-3">Code</th>
                  <th className="text-left font-medium px-6 py-3">Contact</th>
                  <th className="text-right font-medium px-6 py-3">Drivers</th>
                  <th className="text-right font-medium px-6 py-3">Vehicles</th>
                  <th className="text-right font-medium px-6 py-3">Rides</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">No vendors yet.</td></tr>
                )}
                {vendors.map((v) => (
                  <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-3 font-medium">{v.name}</td>
                    <td className="px-6 py-3">
                      <span className="font-mono text-xs bg-secondary px-2 py-1 rounded select-all">
                        {v.vendorCode ?? "—"}
                      </span>
                    </td>
                    <td className="px-6 py-3"><div>{v.contactName}</div><div className="text-xs text-muted-foreground">{v.contactPhone}</div></td>
                    <td className="px-6 py-3 text-right">{v._count?.drivers ?? 0}</td>
                    <td className="px-6 py-3 text-right">{v._count?.vehicles ?? 0}</td>
                    <td className="px-6 py-3 text-right">{v._count?.rides ?? 0}</td>
                    <td className="px-6 py-3">
                      <Badge variant="outline" className={v.user?.isActive === false ? "border-destructive/40 text-destructive" : "border-success/40 text-success"}>
                        {v.user?.isActive === false ? "inactive" : "active"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New vendor (company + login)</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Company</Label><Input className="mt-1" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Apex Fleet" /></div>
            <div><Label>Contact name</Label><Input className="mt-1" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
            <div><Label>Contact phone</Label><Input className="mt-1" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} placeholder="+91 98xxxxxxxx" /></div>
            <div><Label>Contact email</Label><Input type="email" className="mt-1" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
            <div><Label>Login email</Label><Input type="email" className="mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="col-span-2"><Label>Temporary password</Label><Input type="text" className="mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 8 characters" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={createVendor.isPending}>{createVendor.isPending ? "Creating…" : "Create vendor"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
