/**
 * EditGroupDialog — opened from "Load group" in Saved Groups.
 *
 * Shows the group's route on a map, lets the supervisor add or remove
 * employees and reorder stops, then either saves the changes back to the
 * saved group, books a ride with the (possibly edited) list, or both.
 *
 * Deliberately does NOT duplicate fare/vehicle/escort/broadcast logic — that
 * safety-critical flow already lives in Routes.tsx. "Book this ride" hands
 * off to it via router state, landing at Step 2 (route review), exactly where
 * the old direct "Load group" navigation used to land.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useEmployees, useUpdateRouteTemplate, useOptimizeRoute,
  type RouteTemplateRow,
} from "@/lib/queries";
import {
  optimizeStops, buildResult, coordPoint, getPoint, DROP,
  type RouteStop, type RouteResult, type GeoPoint,
} from "@/lib/geo";
import { GoogleRouteMap } from "@/components/GoogleRouteMap";
import { EmployeeList, type UIEmployee } from "@/pages/supervisor/Routes";
import { Loader2, Plus, Save, ArrowRight, Users } from "lucide-react";
import { toast } from "sonner";

export function EditGroupDialog({
  template,
  open,
  onOpenChange,
}: {
  template: RouteTemplateRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const nav = useNavigate();
  const { data: empData } = useEmployees();
  const updateTemplate = useUpdateRouteTemplate();
  const optimizeRoute = useOptimizeRoute();

  const employees: UIEmployee[] = useMemo(
    () => (empData?.employees ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      gender: e.gender?.toUpperCase().startsWith("F") ? "F" : "M",
      pickup: e.pickupAddress,
      loginTime: e.shiftStart,
      logoutTime: e.shiftEnd,
      companyLabel: e.companyLabel,
      pickupLat: e.pickupLat, pickupLng: e.pickupLng, dropLat: e.dropLat, dropLng: e.dropLng,
    })),
    [empData],
  );

  // Employees eligible to add — same office as the group, or unassigned
  // employees if the group has no office (mirrors Routes.tsx's office scoping).
  const officeName = template?.officeLocation?.name ?? null;
  const visibleEmployees = useMemo(() => {
    if (!officeName) return employees;
    return employees.filter((e) => e.companyLabel === officeName || !e.companyLabel);
  }, [employees, officeName]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customStops, setCustomStops] = useState<RouteStop[] | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmBookOpen, setConfirmBookOpen] = useState(false);

  // Reset editing state whenever a different (or no) group is opened.
  // Stale employee IDs (deleted from the roster since the group was saved)
  // are dropped silently — orderedEmployeeIds has no FK to Employee.
  useEffect(() => {
    if (!template) return;
    const validIds = (template.orderedEmployeeIds as string[]).filter(
      (id) => employees.some((e) => e.id === id),
    );
    setSelectedIds(validIds);
    setCustomStops(undefined);
  }, [template?.id, employees.length]);

  const type = template?.rideType ?? "login";
  const selected = visibleEmployees.filter((e) => selectedIds.includes(e.id));

  const dropNode = useMemo(() => {
    const off = template?.officeLocation;
    if (off) return { name: off.name, point: coordPoint(off.lat, off.lng) };
    return { name: DROP, point: getPoint(DROP) };
  }, [template]);

  const fallbackRoute = useMemo(() => {
    if (customStops && customStops.length) return buildResult(customStops, dropNode, type);
    const stops: RouteStop[] = selected.map((e) => ({
      empId: e.id,
      name: e.name,
      gender: e.gender,
      location: e.pickup,
      point: e.pickupLat != null && e.pickupLng != null ? coordPoint(e.pickupLat, e.pickupLng) : getPoint(e.pickup),
    }));
    return optimizeStops(stops, dropNode, type);
  }, [selected, customStops, type, dropNode]);

  const [serverRoute, setServerRoute] = useState<RouteResult | null>(null);
  const [serverPolyline, setServerPolyline] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !template) return;
    if (!selected.length) { setServerRoute(null); setServerPolyline(null); return; }

    const manualOrder = customStops && customStops.length ? customStops : null;
    const stopsForRequest = (manualOrder ?? fallbackRoute.stops).map((s) => ({
      empId: s.empId, lat: s.point.lat, lng: s.point.lng,
    }));
    if (!stopsForRequest.length) return;

    let cancelled = false;
    optimizeRoute.mutate(
      { type, office: { lat: dropNode.point.lat, lng: dropNode.point.lng }, stops: stopsForRequest, optimize: !manualOrder },
      {
        onSuccess: (result) => {
          if (cancelled) return;
          const byId = new Map((manualOrder ?? fallbackRoute.stops).map((s) => [s.empId, s]));
          const ordered = result.stops.map((rs) => byId.get(rs.empId)).filter((s): s is RouteStop => !!s);
          const built = buildResult(ordered, dropNode, type);
          setServerRoute({ ...built, totalKm: result.totalDistanceKm || built.totalKm, etaMin: result.etaMin || built.etaMin });
          setServerPolyline(result.encodedPolyline);
        },
        onError: () => { if (!cancelled) { setServerRoute(null); setServerPolyline(null); } },
      },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template?.id, selected.map((e) => e.id).join(","), customStops]);

  const route = serverRoute ?? fallbackRoute;
  const routeLoading = optimizeRoute.isPending;

  const toggleEmployee = (id: string) => {
    setCustomStops(undefined);
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };
  const reorderStops = (from: number, to: number) => {
    const arr = [...route.stops];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setCustomStops(arr);
  };
  const removeStop = (empId: string) => {
    setSelectedIds((ids) => ids.filter((x) => x !== empId));
    setCustomStops((cs) => cs?.filter((s) => s.empId !== empId));
  };

  // Dirty = membership actually changed, or the supervisor manually reordered.
  // Server-side route optimization alone (efficiency reordering with no user
  // action) must NOT count as dirty — otherwise every load would prompt to
  // save purely because Google chose a different stop order.
  const dirty = useMemo(() => {
    if (!template) return false;
    const original = [...(template.orderedEmployeeIds as string[])].sort();
    const current = [...selectedIds].sort();
    const membershipChanged = JSON.stringify(original) !== JSON.stringify(current);
    return membershipChanged || !!customStops;
  }, [template, selectedIds, customStops]);

  const saveChanges = (onDone?: () => void) => {
    if (!template) return;
    updateTemplate.mutate(
      { id: template.id, orderedEmployeeIds: route.stops.map((s) => s.empId) },
      {
        onSuccess: () => { toast.success("Group updated"); onDone?.(); },
        onError: (e: any) => toast.error(e?.message ?? "Could not save changes"),
      },
    );
  };

  const goToBooking = () => {
    if (!template) return;
    // markUsed, then hand off the CURRENT (possibly unsaved) stop order to the
    // booking flow via router state — Routes.tsx applies it once on mount.
    updateTemplate.mutate({ id: template.id, markUsed: true } as any);
    onOpenChange(false);
    nav("/supervisor/routes", {
      state: {
        presetEmployeeIds: route.stops.map((s) => s.empId),
        presetType: template.rideType,
        presetVehicleType: template.vehicleType ?? undefined,
        presetOfficeLocationId: template.officeLocationId ?? undefined,
      },
    });
  };

  const handleBookClick = () => {
    if (selected.length === 0) { toast.error("Add at least one employee first"); return; }
    if (dirty) { setConfirmBookOpen(true); return; }
    goToBooking();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="truncate">{template?.name}</span>
              <Badge variant="outline" className="capitalize text-[10px] py-0 shrink-0">{type}</Badge>
              {dirty && <Badge className="bg-gold/20 text-gold-dark text-[10px] py-0 shrink-0">unsaved changes</Badge>}
            </DialogTitle>
          </DialogHeader>

          {!template ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{selected.length} employee{selected.length === 1 ? "" : "s"} in this group</span>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add / remove
                </Button>
              </div>

              <GoogleRouteMap
                route={route}
                type={type}
                editable
                routeLoading={routeLoading}
                polyline={serverPolyline}
                onReorder={reorderStops}
                onRemove={removeStop}
                onAdd={() => setAddOpen(true)}
              />
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              disabled={!dirty || updateTemplate.isPending}
              onClick={() => saveChanges()}
            >
              {updateTemplate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save changes
            </Button>
            <Button
              className="w-full sm:w-auto bg-gold text-gold-foreground hover:bg-gold/90"
              onClick={handleBookClick}
            >
              Book this ride <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / remove people */}
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="w-[420px]">
          <SheetHeader><SheetTitle>Add or remove people</SheetTitle></SheetHeader>
          <div className="mt-4">
            <EmployeeList employees={visibleEmployees} selectedIds={selectedIds} onToggle={toggleEmployee} type={type} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Save-before-book confirmation */}
      <AlertDialog open={confirmBookOpen} onOpenChange={setConfirmBookOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes to this group?</AlertDialogTitle>
            <AlertDialogDescription>
              You've added, removed, or reordered people in "{template?.name}". You can save these
              changes back to the group for next time, or just book this ride without updating the
              saved group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => { setConfirmBookOpen(false); goToBooking(); }}
            >
              Book without saving
            </Button>
            <AlertDialogAction
              className="bg-gold text-gold-foreground hover:bg-gold/90"
              onClick={() => { setConfirmBookOpen(false); saveChanges(goToBooking); }}
            >
              Save &amp; book
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
