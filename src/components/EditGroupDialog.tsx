/**
 * EditGroupDialog — opened from "Load group" in Saved Groups.
 *
 * A dense table (Employee / Gender / Pickup-drop point / Time / KM), editable
 * in place: per-stop pickup time via a native time input, remove via the trash
 * icon, add via the sheet opened by "+ Add". No map, no separate route-review
 * screen — this dialog IS the review screen, compact enough to fit without
 * scrolling sideways.
 *
 * "Book this ride" hands off straight to Step 3 (vehicle + fare + broadcast)
 * in Routes.tsx — not Step 2 — because every check Step 2 would otherwise
 * gate on (shift-time mismatch, per-stop time window for the women's-safety
 * check, distance) is already computed and enforced right here, using the
 * exact same shared helpers from lib/geo.ts. Nothing is skipped; it's done
 * once, in this dialog, instead of twice.
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
import { TimeSelect } from "@/components/TimeSelect";
import {
  useEmployees, useUpdateRouteTemplate, useOptimizeRoute,
  type RouteTemplateRow,
} from "@/lib/queries";
import {
  optimizeStops, buildResult, coordPoint, getPoint, DROP, distanceKm,
  computePickupTimeWindow, isWithinPickupWindow,
  type RouteStop, type RouteResult, type GeoPoint,
} from "@/lib/geo";
import { evaluateEscortPolicy } from "@/lib/escortPolicy";
import { EmployeeList, type UIEmployee } from "@/pages/supervisor/Routes";
import { Loader2, Plus, Save, ArrowRight, Trash2, AlertTriangle, ShieldCheck, Shield, Clock } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

  const officeName = template?.officeLocation?.name ?? null;
  const visibleEmployees = useMemo(() => {
    if (!officeName) return employees;
    return employees.filter((e) => e.companyLabel === officeName || !e.companyLabel);
  }, [employees, officeName]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customStops, setCustomStops] = useState<RouteStop[] | undefined>(undefined);
  const [pickupTimes, setPickupTimes] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [confirmBookOpen, setConfirmBookOpen] = useState(false);

  useEffect(() => {
    if (!template) return;
    const validIds = (template.orderedEmployeeIds as string[]).filter(
      (id) => employees.some((e) => e.id === id),
    );
    setSelectedIds(validIds);
    setCustomStops(undefined);
    setPickupTimes({});
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

  useEffect(() => {
    if (!open || !template) return;
    if (!selected.length) { setServerRoute(null); return; }

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
        },
        onError: () => { if (!cancelled) setServerRoute(null); },
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
  const removeStop = (empId: string) => {
    setSelectedIds((ids) => ids.filter((x) => x !== empId));
    setCustomStops((cs) => cs?.filter((s) => s.empId !== empId));
    setPickupTimes((pt) => { const { [empId]: _drop, ...rest } = pt; return rest; });
  };

  // ── Same validation Routes.tsx Step 1→2 and Step 2→3 gate on ────────────────
  const distinctShiftTimes = useMemo(() => {
    const field = type === "logout" ? "logoutTime" : "loginTime";
    const times = selected.map((e) => e[field]).filter(Boolean);
    return Array.from(new Set(times));
  }, [selected, type]);
  const shiftMismatch = distinctShiftTimes.length > 1;
  const groupShiftTime = distinctShiftTimes.length === 1 ? distinctShiftTimes[0] : null;

  const pickupTimeWindow = useMemo(() => computePickupTimeWindow(groupShiftTime, type), [groupShiftTime, type]);

  const femaleStopsWithoutTime = route.stops.filter((s) => s.gender === "F" && !pickupTimes[s.empId]);
  const timeRequiredButMissing = femaleStopsWithoutTime.length > 0;

  const stopsOutsideWindow = pickupTimeWindow
    ? route.stops.filter((s) => pickupTimes[s.empId] && !isWithinPickupWindow(pickupTimes[s.empId], pickupTimeWindow))
    : [];
  const timeOutsideWindow = stopsOutsideWindow.length > 0;

  const escortPolicy = useMemo(() => {
    if (!selected.length) return { required: false } as const;
    const fallback = groupShiftTime ? (() => {
      const [h, m] = groupShiftTime.split(":").map(Number);
      const d = new Date(); d.setHours(h, m, 0, 0); return d;
    })() : null;
    return evaluateEscortPolicy(
      selected.map((e) => ({ gender: e.gender })),
      fallback,
      type,
      route.stops,
      route.stops.map((s) => ({ gender: s.gender, stopTime: pickupTimes[s.empId] ?? null })),
    );
  }, [selected, groupShiftTime, type, route.stops, pickupTimes]);

  const canBook = selected.length > 0 && !shiftMismatch && !timeRequiredButMissing && !timeOutsideWindow;

  const dirty = useMemo(() => {
    if (!template) return false;
    const original = [...(template.orderedEmployeeIds as string[])].sort();
    const current = [...selectedIds].sort();
    return JSON.stringify(original) !== JSON.stringify(current) || !!customStops;
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
    updateTemplate.mutate({ id: template.id, markUsed: true } as any);
    onOpenChange(false);
    nav("/supervisor/routes", {
      state: {
        presetEmployeeIds: route.stops.map((s) => s.empId),
        presetType: template.rideType,
        presetVehicleType: template.vehicleType ?? undefined,
        presetOfficeLocationId: template.officeLocationId ?? undefined,
        presetPickupTimes: pickupTimes,
        // Skip Step 2 — every check it would gate on has already run above,
        // against the same shared helpers Step 2 itself uses.
        presetStep: 3,
      },
    });
  };

  const handleBookClick = () => {
    if (selected.length === 0) { toast.error("Add at least one employee first"); return; }
    if (shiftMismatch) { toast.error("Fix the shift-time mismatch before booking"); return; }
    if (timeRequiredButMissing) { toast.error("Set a pickup time for every female employee first"); return; }
    if (timeOutsideWindow) { toast.error("Fix pickup timings outside the allowed window first"); return; }
    if (dirty) { setConfirmBookOpen(true); return; }
    goToBooking();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto p-0">
          <div className="p-4 pb-0">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap pr-6">
                <span className="truncate">{template?.name}</span>
                <Badge variant="outline" className="capitalize text-[10px] py-0 shrink-0">{type}</Badge>
                {dirty && <Badge className="bg-gold/20 text-gold-dark text-[10px] py-0 shrink-0">unsaved</Badge>}
              </DialogTitle>
            </DialogHeader>
          </div>

          {!template ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : (
            <div className="px-4 pb-4 space-y-3">
              {/* Compact status line — no map, no separate banners taking a
                  full row each; one line, colour-coded. */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-xs flex-wrap min-w-0">
                  {shiftMismatch ? (
                    <span className="flex items-center gap-1 text-destructive font-medium">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Timing mismatch — remove the odd one out
                    </span>
                  ) : escortPolicy.required ? (
                    <span className="flex items-center gap-1 text-destructive font-medium">
                      <Shield className="h-3.5 w-3.5 shrink-0" /> Escort required
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-success">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" /> Safety OK
                    </span>
                  )}
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground whitespace-nowrap">
                    {routeLoading ? "calculating…" : `${route.totalKm} km · ~${route.etaMin} min`}
                  </span>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>

              {(timeRequiredButMissing || timeOutsideWindow) && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {timeRequiredButMissing
                    ? `Set a pickup time for: ${femaleStopsWithoutTime.map((s) => s.name).join(", ")}`
                    : `Outside the allowed window (${pickupTimeWindow?.min}–${pickupTimeWindow?.max}): ${stopsOutsideWindow.map((s) => s.name).join(", ")}`}
                </div>
              )}

              {/* ── Dense table — this replaces the map + stop-list combo ──── */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-2 py-1.5 w-6">#</th>
                      <th className="text-left font-medium px-2 py-1.5">Employee</th>
                      <th className="text-left font-medium px-2 py-1.5 w-14">Gender</th>
                      <th className="text-left font-medium px-2 py-1.5">Pickup point</th>
                      <th className="text-left font-medium px-2 py-1.5 w-24">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Time</span>
                      </th>
                      <th className="text-right font-medium px-2 py-1.5 w-14">KM</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {route.stops.map((s, i) => {
                      const prevPoint = i === 0 ? dropNode.point : route.stops[i - 1].point;
                      const legKm = Math.round(distanceKm(prevPoint, s.point) * 10) / 10;
                      const outside = pickupTimeWindow && pickupTimes[s.empId]
                        ? !isWithinPickupWindow(pickupTimes[s.empId], pickupTimeWindow)
                        : false;
                      return (
                        <tr key={s.empId} className="hover:bg-muted/30">
                          <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                          <td className="px-2 py-1.5 font-medium max-w-[140px] truncate">{s.name}</td>
                          <td className="px-2 py-1.5">
                            {s.gender === "F" ? (
                              <Badge variant="outline" className="border-gold/40 bg-gold-soft text-gold-dark text-[10px] py-0">F</Badge>
                            ) : (
                              <span className="text-muted-foreground">M</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground max-w-[220px] truncate" title={s.location}>
                            {s.location}
                          </td>
                          <td className="px-2 py-1.5">
                            <TimeSelect
                              value={pickupTimes[s.empId] ?? ""}
                              onChange={(v) => setPickupTimes((prev) => ({ ...prev, [s.empId]: v }))}
                              className={cn(
                                "h-6 w-[88px] px-1 text-[11px] font-mono",
                                outside && "border-destructive text-destructive",
                              )}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">{legKm}</td>
                          <td className="px-1 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => removeStop(s.empId)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Remove ${s.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {route.stops.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                          No employees yet — click Add.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {route.stops.length > 0 && (
                    <tfoot className="bg-foreground/5 border-t-2 border-foreground/20">
                      <tr>
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5 font-semibold" colSpan={3}>
                          Drop: {dropNode.name}
                        </td>
                        <td className="px-2 py-1.5" />
                        <td className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">
                          {Math.round(distanceKm(route.stops[route.stops.length - 1].point, dropNode.point) * 10) / 10}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between px-4 py-3 border-t bg-background sticky bottom-0">
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
              disabled={!canBook}
              onClick={handleBookClick}
            >
              Book this ride <ArrowRight className="h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="w-[420px]">
          <SheetHeader><SheetTitle>Add or remove people</SheetTitle></SheetHeader>
          <div className="mt-4">
            <EmployeeList employees={visibleEmployees} selectedIds={selectedIds} onToggle={toggleEmployee} type={type} />
          </div>
        </SheetContent>
      </Sheet>

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
            <Button variant="outline" onClick={() => { setConfirmBookOpen(false); goToBooking(); }}>
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
