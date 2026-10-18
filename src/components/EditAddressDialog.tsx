import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PlacesInput } from "@/components/PlacesInput";
import { PinMap } from "@/components/AddEmployeeDialog";
import { api } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Move, Loader2 } from "lucide-react";
import type { EmployeeRow } from "@/lib/queries";

/**
 * Edit an employee's pickup/home address (and map pin) from anywhere (e.g. a
 * group manifest row). Saving updates the EMPLOYEE master record via the same
 * PATCH the Roster uses — so the change reflects on the roster and every group.
 * A confirmation step guards the save.
 */
export function EditAddressDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: EmployeeRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset the local pick whenever a new employee opens.
  const current = picked ??
    (employee && employee.pickupLat != null && employee.pickupLng != null
      ? { lat: employee.pickupLat, lng: employee.pickupLng, address: employee.pickupAddress }
      : null);

  const save = async () => {
    if (!employee || !picked) return;
    setSaving(true);
    try {
      await api(`/employees/${employee.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          pickupLocation: { lat: picked.lat, lng: picked.lng },
          pickupAddress: picked.address,
        }),
      });
      // Refresh roster + anything that reads employees (groups, booking).
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(`${employee.name}'s address updated`);
      setConfirmOpen(false);
      onOpenChange(false);
      setPicked(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update address");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) setPicked(null); onOpenChange(o); }}>
        <DialogContent className="max-w-3xl overflow-hidden p-0">
          <div className="flex flex-col md:flex-row">
            {/* Form */}
            <div className="flex-1 min-w-0 p-6 space-y-3">
              <DialogHeader>
                <DialogTitle>Edit address — {employee?.name}</DialogTitle>
              </DialogHeader>
              <div className="text-xs text-muted-foreground">
                Updates the employee's home/pickup address on the roster. Used for
                all future rides and groups.
              </div>
              <div>
                <Label className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> New pickup address
                </Label>
                <div className="mt-1">
                  <PlacesInput
                    placeholder="Search the new home address…"
                    onSelect={(v) => setPicked(v)}
                  />
                </div>
                <div className="mt-1.5 text-xs rounded bg-secondary px-2.5 py-1.5 text-muted-foreground flex items-start gap-1">
                  <MapPin className="h-3 w-3 shrink-0 mt-0.5 text-gold" />
                  {current?.address ?? employee?.pickupAddress ?? "—"}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Search a new address or drag the pin to fine-tune the location.
                </div>
              </div>
              <DialogFooter className="mt-4">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
                <Button
                  className="bg-foreground text-background hover:bg-foreground/90"
                  onClick={() => setConfirmOpen(true)}
                  disabled={!picked || saving}
                >
                  Save changes
                </Button>
              </DialogFooter>
            </div>
            {/* Map */}
            <div className="w-full md:w-80 border-t md:border-t-0 md:border-l bg-muted/30 flex flex-col">
              <div className="px-4 py-3 border-b flex items-center gap-2 text-sm font-medium">
                <Move className="h-4 w-4 text-muted-foreground" />
                {picked ? "Drag pin to exact location" : "Map preview"}
              </div>
              <div className="flex-1 relative min-h-[260px]">
                <PinMap location={current} onMoved={(loc) => setPicked(loc)} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update {employee?.name}'s address?</AlertDialogTitle>
            <AlertDialogDescription>
              This changes the employee's pickup address on the <b>roster</b> and will
              apply to all future rides and groups.
              <div className="mt-2 rounded bg-muted px-2.5 py-2 text-xs text-foreground">
                {picked?.address}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-foreground text-background hover:bg-foreground/90"
              onClick={(e) => { e.preventDefault(); save(); }}
              disabled={saving}
            >
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : "Confirm & update"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
