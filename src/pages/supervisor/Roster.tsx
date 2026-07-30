import { useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmployees, useDeleteEmployee, useOfficeLocations, useUpdateEmployeeCompany } from "@/lib/queries";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Plus, Search, Trash2, Loader2, Building2, Pencil } from "lucide-react";
import { AddEmployeeDialog } from "@/components/AddEmployeeDialog";
import { CsvImportDialog } from "@/components/CsvImportDialog";
import { PlacesInput } from "@/components/PlacesInput";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import type { EmployeeRow } from "@/lib/queries";

export default function Roster() {
  const { data, isLoading } = useEmployees();
  const { data: locationsData } = useOfficeLocations();
  const deleteEmployee = useDeleteEmployee();
  const updateCompany = useUpdateEmployeeCompany();
  const employees = data?.employees ?? [];
  const offices = locationsData?.offices ?? [];
  const [q, setQ] = useState("");
  const [company, setCompany] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editEmployee, setEditEmployee] = useState<EmployeeRow | null>(null);

  // Unique company labels across all employees
  const companies = Array.from(
    new Set(employees.map((e) => e.companyLabel).filter(Boolean) as string[])
  );

  const filtered = employees
    .filter((e) => company === "all" || e.companyLabel === company)
    .filter((e) =>
      e.name.toLowerCase().includes(q.toLowerCase()) ||
      e.empId.toLowerCase().includes(q.toLowerCase())
    );

  const target = employees.find((e) => e.id === confirmId);
  const isFemale = (g: string) => g?.toUpperCase().startsWith("F");

  return (
    <div>
      <PageHeader
        title="Employee Roster"
        description="Master list of employees eligible for cab booking."
        actions={
          <>
            <Button variant="outline" onClick={() => setCsvOpen(true)}><Upload className="h-4 w-4" /> Upload CSV</Button>
            <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add employee</Button>
          </>
        }
      />

      <Card className="shadow-card">
        <CardContent className="p-0">
          <div className="p-4 border-b flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search by name or ID…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
            </div>
            {/* Company filter */}
            {companies.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button onClick={() => setCompany("all")}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${company === "all" ? "bg-foreground text-background border-foreground" : "border-border hover:border-foreground/40"}`}>
                  All
                </button>
                {companies.map((c) => (
                  <button key={c} onClick={() => setCompany(c)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${company === c ? "bg-gold text-gold-foreground border-gold" : "border-border hover:border-gold/40"}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <Badge variant="outline" className="ml-auto">{filtered.length} of {employees.length}</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-6 py-3">Employee ID</th>
                  <th className="text-left font-medium px-6 py-3">Name</th>
                  <th className="text-left font-medium px-6 py-3">Company</th>
                  <th className="text-left font-medium px-6 py-3">Gender</th>
                  <th className="text-left font-medium px-6 py-3">Phone</th>
                  <th className="text-left font-medium px-6 py-3">Pickup</th>
                  <th className="text-left font-medium px-6 py-3">Login</th>
                  <th className="text-left font-medium px-6 py-3">Logout</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-6 py-3 font-mono text-xs">{e.empId}</td>
                    <td className="px-6 py-3 font-medium">{e.name}</td>
                    <td className="px-6 py-3">
                      {offices.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="flex items-center gap-1 group focus:outline-none">
                              {e.companyLabel
                                ? <Badge variant="outline" className="border-gold/40 text-gold-dark bg-gold-soft text-[10px] group-hover:border-gold cursor-pointer">{e.companyLabel}</Badge>
                                : <span className="text-xs text-muted-foreground group-hover:text-foreground flex items-center gap-1 cursor-pointer"><Building2 className="h-3 w-3" /> Assign</span>}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            {offices.map((o) => (
                              <DropdownMenuItem key={o.id}
                                className={e.companyLabel === o.name ? "bg-gold-soft text-gold-dark" : ""}
                                onClick={() => updateCompany.mutate(
                                  { id: e.id, companyLabel: o.name },
                                  { onSuccess: () => toast.success(`${e.name} → ${o.name}`), onError: (err: any) => toast.error(err?.message ?? "Failed") },
                                )}>
                                {o.name}
                              </DropdownMenuItem>
                            ))}
                            {e.companyLabel && (
                              <DropdownMenuItem className="text-muted-foreground"
                                onClick={() => updateCompany.mutate(
                                  { id: e.id, companyLabel: null },
                                  { onSuccess: () => toast.success("Company cleared"), onError: (err: any) => toast.error(err?.message ?? "Failed") },
                                )}>
                                Clear
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        e.companyLabel
                          ? <Badge variant="outline" className="border-gold/40 text-gold-dark bg-gold-soft text-[10px]">{e.companyLabel}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant="outline" className={isFemale(e.gender) ? "border-gold/40 text-gold-dark bg-gold-soft" : ""}>{isFemale(e.gender) ? "Female" : "Male"}</Badge>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{e.phone ?? "—"}</td>
                    <td className="px-6 py-3">{e.pickupAddress}</td>
                    <td className="px-6 py-3 font-mono text-xs">{e.shiftStart}</td>
                    <td className="px-6 py-3 font-mono text-xs">{e.shiftEnd}</td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => setEditEmployee(e)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setConfirmId(e.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">{employees.length === 0 ? "No employees yet — add your first one." : "No employees match your search"}</td></tr>
                )}
                {isLoading && (
                  <tr><td colSpan={9} className="text-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gold mx-auto" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AddEmployeeDialog open={addOpen} onOpenChange={setAddOpen} />
      <CsvImportDialog open={csvOpen} onOpenChange={setCsvOpen} />

      {editEmployee && (
        <EditEmployeeDialog
          employee={editEmployee}
          offices={offices}
          onClose={() => setEditEmployee(null)}
        />
      )}

      <AlertDialog open={!!confirmId} onOpenChange={(o) => !o && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {target?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the employee from your roster. This can be undone by re-adding them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirmId) deleteEmployee.mutate(confirmId, {
                onSuccess: () => toast.success("Employee removed"),
                onError: (e: any) => toast.error(e?.message ?? "Failed to remove"),
              });
              setConfirmId(null);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Edit Employee Dialog ─────────────────────────────────────────────────────

function EditEmployeeDialog({
  employee,
  offices,
  onClose,
}: {
  employee: EmployeeRow;
  offices: { id: string; name: string; isDefault: boolean }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: employee.name,
    phone: employee.phone ?? "",
    gender: employee.gender?.toUpperCase().startsWith("F") ? "F" : "M",
    shiftStart: employee.shiftStart,
    shiftEnd: employee.shiftEnd,
    companyLabel: employee.companyLabel ?? "",
  });
  // Pickup location — starts as the current saved address, can be updated via PlacesInput
  const [pickup, setPickup] = useState<{ lat: number; lng: number; address: string } | null>(
    employee.pickupLat != null && employee.pickupLng != null
      ? { lat: employee.pickupLat, lng: employee.pickupLng, address: employee.pickupAddress }
      : null
  );
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api(`/employees/${employee.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          phone: form.phone || undefined,
          gender: form.gender === "F" ? "female" : "male",
          shiftStart: form.shiftStart,
          shiftEnd: form.shiftEnd,
          companyLabel: form.companyLabel || null,
          // Only send pickup if it was changed
          ...(pickup && pickup.address !== employee.pickupAddress ? {
            pickupLocation: { lat: pickup.lat, lng: pickup.lng },
            pickupAddress: pickup.address,
          } : {}),
        }),
      });
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`${form.name} updated`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit employee — {employee.empId}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            <Label>Full name</Label>
            <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>

          <div>
            <Label>Gender</Label>
            <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v as "M" | "F" })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M">Male</SelectItem>
                <SelectItem value="F">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Phone</Label>
            <Input className="mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 ..." />
          </div>

          {/* Pickup location */}
          <div className="col-span-2">
            <Label>Pickup / Home address</Label>
            <div className="mt-1">
              <PlacesInput
                placeholder="Search new pickup address…"
                onSelect={(loc) => setPickup(loc)}
              />
            </div>
            <div className="mt-1.5 text-xs rounded bg-secondary px-2.5 py-1.5 text-muted-foreground">
              📍 {pickup?.address ?? employee.pickupAddress}
            </div>
          </div>

          <div>
            <Label>Login time</Label>
            <Input className="mt-1" value={form.shiftStart} onChange={(e) => setForm({ ...form, shiftStart: e.target.value })} />
          </div>

          <div>
            <Label>Logout time</Label>
            <Input className="mt-1" value={form.shiftEnd} onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })} />
          </div>

          {offices.length > 0 && (
            <div className="col-span-2">
              <Label>Company / Office</Label>
              <Select
                value={form.companyLabel || "__none__"}
                onValueChange={(v) => setForm({ ...form, companyLabel: v === "__none__" ? "" : v })}
              >
                <SelectTrigger className="mt-1"><SelectValue placeholder="No company assigned" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No company —</SelectItem>
                  {offices.map((o) => (
                    <SelectItem key={o.id} value={o.name}>
                      {o.name}{o.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button className="bg-foreground text-background hover:bg-foreground/90" onClick={submit} disabled={saving}>
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
