import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useTenants, useCreateTenant, useSetTenantActive } from "@/lib/queries";
import { Plus, Loader2, Power } from "lucide-react";
import { toast } from "sonner";

export default function Supervisors() {
  const { data, isLoading } = useTenants();
  const createTenant = useCreateTenant();
  const setActive = useSetTenantActive();
  const tenants = data?.tenants ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ company: "", fullName: "", email: "", password: "" });

  const submit = () => {
    if (!form.company || !form.fullName || !form.email || form.password.length < 8) {
      toast.error("All fields required · password ≥ 8 chars");
      return;
    }
    createTenant.mutate(form, {
      onSuccess: () => { toast.success(`Tenant ${form.company} created`); setOpen(false); setForm({ company: "", fullName: "", email: "", password: "" }); },
      onError: (e: any) => toast.error(e?.message ?? "Could not create tenant"),
    });
  };

  return (
    <div>
      <PageHeader title="Tenants & Supervisors" description="Companies and their supervisor logins on RideOps."
        actions={<Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New tenant</Button>} />
      <Card className="shadow-card">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Supervisor</th>
                  <th className="text-left font-medium px-6 py-3">Company</th>
                  <th className="text-left font-medium px-6 py-3">Email</th>
                  <th className="text-right font-medium px-6 py-3">Employees</th>
                  <th className="text-right font-medium px-6 py-3">Rides</th>
                  <th className="text-left font-medium px-6 py-3">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-10 text-center text-muted-foreground">No tenants yet — create your first one.</td></tr>
                )}
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-3 font-medium">{t.fullName}</td>
                    <td className="px-6 py-3">{t.org ?? "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{t.email}</td>
                    <td className="px-6 py-3 text-right">{t.employeeCount}</td>
                    <td className="px-6 py-3 text-right">{t.rideCount}</td>
                    <td className="px-6 py-3"><Badge variant="outline" className={t.isActive ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}>{t.isActive ? "active" : "disabled"}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      <Button size="sm" variant="ghost" disabled={setActive.isPending}
                        onClick={() => setActive.mutate({ id: t.id, isActive: !t.isActive }, {
                          onSuccess: () => toast.success(t.isActive ? "Tenant disabled" : "Tenant enabled"),
                          onError: (e: any) => toast.error(e?.message ?? "Failed"),
                        })}>
                        <Power className="h-3.5 w-3.5" /> {t.isActive ? "Disable" : "Enable"}
                      </Button>
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
          <DialogHeader><DialogTitle>New tenant (company + supervisor)</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 gap-3 py-2">
            <div><Label>Company</Label><Input className="mt-1" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Acme Corp" /></div>
            <div><Label>Supervisor name</Label><Input className="mt-1" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
            <div><Label>Login email</Label><Input type="email" className="mt-1" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Temporary password</Label><Input type="text" className="mt-1" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="≥ 8 characters" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={createTenant.isPending}>{createTenant.isPending ? "Creating…" : "Create tenant"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
