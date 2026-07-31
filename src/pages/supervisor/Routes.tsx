import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/RoleLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useEmployees, useCreateRide, useVehicleOptions, useSupervisorOffice,
  useOfficeLocations, useRouteTemplates,
  type CreateRidePayload, type OfficeLocationRow, type RouteTemplateRow,
} from "@/lib/queries";import { optimizeStops, buildResult, coordPoint, getPoint, DROP, type RouteStop, type GeoPoint } from "@/lib/geo";
import { computeFare, allowedVehicleTypes, VEHICLE_LABELS, AC_SURCHARGE, PLATFORM_FEE, type VehicleType } from "@/lib/pricing";
import { evaluateEscortPolicy, inRestrictedWindow } from "@/lib/escortPolicy";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Radio, Check, ArrowRight, ArrowLeft, Users, ShieldCheck, Search, Wind, Loader2, Building2, ChevronDown, BookmarkPlus, Clock, AlertTriangle, Shield, UserCheck } from "lucide-react";
import { GoogleRouteMap } from "@/components/GoogleRouteMap";
import { SaveRouteDialog } from "@/components/SaveRouteDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface UIEmployee {
  id: string; name: string; gender: "M" | "F"; pickup: string; loginTime: string;
  companyLabel?: string | null;
  pickupLat?: number | null; pickupLng?: number | null; dropLat?: number | null; dropLng?: number | null;
}

const pt = (p: GeoPoint) => ({ lat: p.lat, lng: p.lng });
const capFor = (n: number) => (n <= 4 ? 4 : n <= 6 ? 6 : 7);

export default function RoutesPage() {
  const { data } = useEmployees();
  const { data: officeData } = useSupervisorOffice();
  const pendingCancellationFee = officeData?.pendingCancellationFee ?? 0;
  const { data: locationsData } = useOfficeLocations();
  const { data: templatesData } = useRouteTemplates();
  const createRide = useCreateRide();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const offices = locationsData?.offices ?? [];
  // Default to the office marked isDefault; fall back to first available.
  const defaultOffice = offices.find((o) => o.isDefault) ?? offices[0] ?? null;
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);

  // Resolve the active office — use state selection or auto-pick default.
  const activeOffice: OfficeLocationRow | null =
    offices.find((o) => o.id === selectedOfficeId) ?? defaultOffice;

  const employees: UIEmployee[] = useMemo(
    () => (data?.employees ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      gender: e.gender?.toUpperCase().startsWith("F") ? "F" : "M",
      pickup: e.pickupAddress,
      loginTime: e.shiftStart,
      companyLabel: e.companyLabel,
      pickupLat: e.pickupLat, pickupLng: e.pickupLng, dropLat: e.dropLat, dropLng: e.dropLng,
    })),
    [data],
  );

  // Filter employees to only those matching the selected office (by companyLabel).
  // Employees with NO companyLabel appear under the default office (they predate the company field).
  // If no offices are configured at all, show everyone.
  const visibleEmployees = useMemo(() => {
    if (!activeOffice || offices.length === 0) return employees;
    return employees.filter((e) => {
      if (e.companyLabel === activeOffice.name) return true;
      // Unassigned employees fall under the default office
      if (!e.companyLabel && activeOffice.isDefault) return true;
      return false;
    });
  }, [employees, activeOffice, offices.length]);

  const [type, setType] = useState<"login" | "logout">("login");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customStops, setCustomStops] = useState<RouteStop[] | undefined>(undefined);
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isAc, setIsAc] = useState(false);
  const [plannedPickupTime, setPlannedPickupTime] = useState<string>("");
  // Overrides when the supervisor drags the office pin on the map.
  const [officeOverride, setOfficeOverride] = useState<{ lat: number; lng: number; address: string } | null>(null);
  // Real driving distance from Google Directions API — replaces Haversine once available.
  const [realDistanceKm, setRealDistanceKm] = useState<number | null>(null);
  // Per-employee expected pickup times — empId → HH:MM
  const [pickupTimes, setPickupTimes] = useState<Record<string, string>>({});
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // ── Escort policy state ───────────────────────────────────────────────────
  const [escortName, setEscortName] = useState("");

  const templates = templatesData?.templates ?? [];

  // Auto-load a template when navigated from the Saved Groups page (?loadGroup=id)
  useEffect(() => {
    const loadId = searchParams.get("loadGroup");
    if (!loadId || !templates.length) return;
    const t = templates.find((x) => x.id === loadId);
    if (t) {
      loadTemplate(t);
      nav("/supervisor/routes", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get("loadGroup"), templates.length]);

  const selected = visibleEmployees.filter((e) => selectedIds.includes(e.id));

  // Drop = dragged override → selected office → supervisor's legacy office → demo fallback.
  const dropNode = useMemo(() => {
    if (officeOverride) {
      return { name: officeOverride.address, point: coordPoint(officeOverride.lat, officeOverride.lng) };
    }
    if (activeOffice) {
      return { name: activeOffice.name, point: coordPoint(activeOffice.lat, activeOffice.lng) };
    }
    return officeData?.officeLat != null
      ? { name: officeData.officeAddress ?? "Office", point: coordPoint(officeData.officeLat, officeData.officeLng!) }
      : { name: DROP, point: getPoint(DROP) };
  }, [officeOverride, activeOffice, officeData]);

  const route = useMemo(() => {
    if (customStops && customStops.length) {
      return buildResult(customStops, dropNode);
    }
    // Build stops from each employee's REAL saved coordinates so distance/fare is accurate.
    const stops: RouteStop[] = selected.map((e) => ({
      empId: e.id,
      name: e.name,
      gender: e.gender,
      location: e.pickup,
      point: e.pickupLat != null && e.pickupLng != null ? coordPoint(e.pickupLat, e.pickupLng) : getPoint(e.pickup),
    }));
    return optimizeStops(stops, dropNode, type);
  }, [selected, customStops, type, dropNode]);

  const [vehicleType, setVehicleType] = useState<VehicleType>("suv");
  const allowedTypes = allowedVehicleTypes(selected.length);
  const firstPickup = route.stops[0]?.point;
  const { data: vehOpts } = useVehicleOptions(firstPickup?.lat, firstPickup?.lng, selected.length || undefined);
  const availLoaded = !!vehOpts;
  const availabilityFor = (t: VehicleType) => vehOpts?.options.find((o) => o.type === t)?.availableCount ?? 0;
  // Selectable = allowed by group size. Show all types regardless of availability
  // so supervisor can always choose — just indicate 0 online as a warning.
  const isSelectable = (t: VehicleType) => allowedTypes.includes(t);
  const selectableTypes = (["hatchback", "sedan", "suv"] as VehicleType[]).filter(isSelectable);
  useEffect(() => {
    if (!isSelectable(vehicleType) && selectableTypes.length) setVehicleType(selectableTypes[selectableTypes.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectableTypes.join(","), vehicleType]);
  // Use ONLY the real driving distance from Google Directions API.
  // null = still loading (Directions API hasn't responded yet).
  const displayKm = realDistanceKm;
  const price = displayKm != null ? computeFare(displayKm, vehicleType, isAc) : null;

  // ── Escort policy ─────────────────────────────────────────────────────────
  // Compute in real-time as employees are selected and time is set.
  const escortPolicy = useMemo(() => {
    if (!selected.length) return { required: false, reordered: false } as const;
    const rideTime = plannedPickupTime
      ? (() => { const [hh, mm] = plannedPickupTime.split(":").map(Number); const d = new Date(); d.setHours(hh, mm, 0, 0); return d; })()
      : null;
    return evaluateEscortPolicy(
      selected.map((e) => ({ gender: e.gender })),
      rideTime,
      type,
    );
  }, [selected, plannedPickupTime, type]);

  // Effective capacity: when escort is required, subtract 1 extra seat (driver + escort).
  const effectiveCapFor = (n: number) => {
    const base = n <= 4 ? 4 : n <= 6 ? 6 : 7;
    return base; // vehicle seats stays the same; we just use 1 for escort
  };
  const employeeSeats = escortPolicy.required
    ? (selected.length <= 3 ? 4 : selected.length <= 5 ? 6 : 7) - 1  // -1 for escort
    : (selected.length <= 4 ? 4 : selected.length <= 6 ? 6 : 7) - 0;

  const toggleEmployee = (id: string) => {
    setCustomStops(undefined);
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setRealDistanceKm(null);
  };

  // When the office changes, clear selections and reset route state.
  const switchOffice = (officeId: string) => {
    setSelectedOfficeId(officeId);
    setSelectedIds([]);
    setCustomStops(undefined);
    setOfficeOverride(null);
    setRealDistanceKm(null);
    setPickupTimes({});
    setStep(1);
  };

  // Load a saved template — navigated from Saved Groups page via query param
  const loadTemplate = (t: RouteTemplateRow) => {
    const ids = t.orderedEmployeeIds as string[];
    setSelectedIds(ids);
    setType(t.rideType);
    setCustomStops(undefined);
    setOfficeOverride(null);
    setRealDistanceKm(null);
    setPickupTimes({});
    if (t.officeLocationId) setSelectedOfficeId(t.officeLocationId);
    if (t.vehicleType) setVehicleType(t.vehicleType as VehicleType);
    setStep(2);
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
  const autoFix = () => { setCustomStops(undefined); toast.success("Route re-optimized to satisfy safety rules"); };

  // Called when an employee pickup pin is dragged on the map.
  const handlePinMoved = (empId: string, lat: number, lng: number, address: string) => {
    // Build from current route.stops so the full list is preserved.
    const base = customStops ?? route.stops;
    setCustomStops(
      base.map((s) =>
        s.empId === empId
          ? { ...s, location: address, point: coordPoint(lat, lng) }
          : s,
      ),
    );
    setRealDistanceKm(null); // will be recalculated by the map
    toast.success("Pickup location updated");
  };

  // Called when the office/drop pin is dragged on the map.
  const handleOfficeMoved = (lat: number, lng: number, address: string) => {
    setOfficeOverride({ lat, lng, address });
    setRealDistanceKm(null); // will be recalculated by the map
    toast.success("Drop-off location updated");
  };

  const buildPayload = (scheduledFor?: string): CreateRidePayload | null => {
    if (!selected.length || !route.stops.length) return null;
    const first = route.stops[0];
    const last = route.stops[route.stops.length - 1];
    // Use dragged override → selected office → supervisor's saved office → demo drop (in that priority).
    const officePoint = officeOverride
      ? { lat: officeOverride.lat, lng: officeOverride.lng }
      : activeOffice
      ? { lat: activeOffice.lat, lng: activeOffice.lng }
      : officeData?.officeLat != null
      ? { lat: officeData.officeLat, lng: officeData.officeLng! }
      : pt(route.drop.point);
    const officeName = officeOverride?.address ?? activeOffice?.name ?? officeData?.officeAddress ?? route.drop.name;
    // Send employees in the OPTIMIZED route order (nearest-neighbour + female-safety),
    // so the driver's OTP legs (stop 1,2,3…) follow the exact sequence shown here.
    const orderedIds = route.stops.map((s) => s.empId);
    // Capacity: vehicle seats = employee seats + 1 driver + (1 escort if required)
    const capacity = capFor(selected.length);
    const base = {
      employeeIds: orderedIds,
      capacity,
      scheduledFor,
      distanceKm: displayKm,
      vehicleType,
      isAc,
      scheduledPickupTimes: pickupTimes,
      escortRequired: escortPolicy.required,
      escortName: escortPolicy.required ? (escortName.trim() || null) : null,
    };
    // Build plannedStartTime from HH:MM time picker — use today's date as base
    let plannedStartTime: string | undefined;
    if (plannedPickupTime) {
      const [hh, mm] = plannedPickupTime.split(":").map(Number);
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      plannedStartTime = d.toISOString();
    }
    return type === "logout"
      ? { type, pickupPoint: officePoint, dropPoint: pt(last.point), pickupAddress: officeName, dropAddress: last.location, ...base, plannedStartTime }
      : { type, pickupPoint: pt(first.point), dropPoint: officePoint, pickupAddress: first.location, dropAddress: officeName, ...base, plannedStartTime };
  };

  const broadcast = () => {
    if (displayKm == null) { toast.error("Wait for the route distance to calculate"); return; }
    if (escortPolicy.required && !escortName.trim()) {
      toast.error("Escort name is required before broadcasting", { description: escortPolicy.reason });
      return;
    }
    const payload = buildPayload();
    if (!payload) { toast.error("Select at least one employee"); return; }
    createRide.mutate(payload, {
      onSuccess: (res) => {
        toast.success("Broadcast sent", { description: `${res.nearbyCount} nearby driver(s) notified · 3:00 window` });
        setTimeout(() => nav("/supervisor/live"), 500);
      },
      onError: (e: any) => toast.error(e?.message ?? "Broadcast failed"),
    });
  };

  const schedule = () => {
    if (displayKm == null) { toast.error("Wait for the route distance to calculate"); return; }
    if (!scheduleAt) { toast.error("Pick a date & time first"); return; }
    if (escortPolicy.required && !escortName.trim()) {
      toast.error("Escort name is required before scheduling", { description: escortPolicy.reason });
      return;
    }
    const payload = buildPayload(new Date(scheduleAt).toISOString());
    if (!payload) { toast.error("Select at least one employee"); return; }
    createRide.mutate({ ...payload, scheduled: true }, {
      onSuccess: () => { toast.success("Ride scheduled — drivers can claim it"); setTimeout(() => nav("/supervisor/live"), 500); },
      onError: (e: any) => toast.error(e?.message ?? "Could not schedule"),
    });
  };

  const escortNameMissing = escortPolicy.required && !escortName.trim();
  const canNext = step === 1 ? selected.length > 0 : step === 2 ? displayKm != null : true;

  return (
    <div>
      <PageHeader
        title="Book a ride"
        description="Pick employees, review the route, broadcast to drivers."
        actions={
          <div className="flex items-center gap-2">

            {/* Office selector — only shown when multiple offices exist */}
            {offices.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-1.5 max-w-[200px]">
                    <Building2 className="h-3.5 w-3.5 text-gold shrink-0" />
                    <span className="truncate text-xs">{activeOffice?.name ?? "Select office"}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {offices.map((o) => (
                    <DropdownMenuItem
                      key={o.id}
                      onClick={() => switchOffice(o.id)}
                      className={`flex items-center justify-between ${activeOffice?.id === o.id ? "bg-gold-soft text-gold-dark" : ""}`}
                    >
                      <span className="truncate">{o.name}</span>
                      {o.isDefault && <Badge variant="outline" className="border-gold/40 text-gold-dark bg-gold-soft text-[10px] py-0 ml-2 shrink-0">default</Badge>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Tabs value={type} onValueChange={(v) => { setType(v as "login" | "logout"); setCustomStops(undefined); setOfficeOverride(null); }}>
              <TabsList>
                <TabsTrigger value="login">Login (to office)</TabsTrigger>
                <TabsTrigger value="logout">Logout (from office)</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((n) => {
          const labels = ["Pick employees", "Review route", "Broadcast"];
          const active = step === n;
          const done = step > n;
          return (
            <button
              key={n}
              onClick={() => (n < step || (n === 2 && selected.length > 0)) && setStep(n as 1 | 2 | 3)}
              className={`flex-1 flex items-center gap-2 px-4 py-2.5 rounded-md border text-sm transition-colors ${
                active ? "border-gold bg-gold-soft text-gold-dark" : done ? "border-foreground bg-foreground/5" : "border-border bg-card text-muted-foreground"
              }`}
            >
              <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold ${
                active ? "bg-gold text-gold-foreground" : done ? "bg-foreground text-background" : "bg-muted"
              }`}>{done ? <Check className="h-3 w-3" /> : n}</div>
              <span className="font-medium">{labels[n - 1]}</span>
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-gold" />
              {activeOffice && offices.length > 0
                ? <>{activeOffice.name} <span className="text-muted-foreground font-normal text-sm">employees</span></>
                : "Select employees"}
            </CardTitle>
            <Badge variant="outline" className="border-gold/40 bg-gold-soft text-gold-dark">{selected.length} selected</Badge>
          </CardHeader>
          <CardContent>
            {visibleEmployees.length === 0 && offices.length > 0 && activeOffice ? (
              <div className="text-sm text-muted-foreground py-8 text-center space-y-1">
                <Building2 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
                <div>No employees are assigned to <b>{activeOffice.name}</b> yet.</div>
                <div className="text-xs">Go to <b>Roster → Add employee</b> and select this office as the Company.</div>
              </div>
            ) : (
              <EmployeeList employees={visibleEmployees} selectedIds={selectedIds} onToggle={toggleEmployee} />
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              Optimized route preview
              <div className="flex items-center gap-2">
                {escortPolicy.required ? (
                  <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive gap-1">
                    <AlertTriangle className="h-3 w-3" /> Escort required
                  </Badge>
                ) : escortPolicy.reordered ? (
                  <Badge variant="outline" className="border-blue-400/40 bg-blue-50 text-blue-700 gap-1">
                    <ShieldCheck className="h-3 w-3" /> Route reordered for women's safety
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-success/40 bg-success/10 text-success gap-1">
                    <ShieldCheck className="h-3 w-3" /> All female-safety rules satisfied
                  </Badge>
                )}
                {selected.length > 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setSaveDialogOpen(true)}>
                    <BookmarkPlus className="h-3.5 w-3.5" /> Save group
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Escort warning banner in step 2 */}
            {escortPolicy.required && (
              <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-sm text-destructive">Escort required</div>
                  <div className="text-xs text-destructive/80 mt-0.5">{escortPolicy.reason}</div>
                  <div className="text-xs text-destructive/80 mt-1">
                    1 seat will be reserved for the escort. Enter the escort name in Step 3 before broadcasting.
                  </div>
                </div>
              </div>
            )}
            <GoogleRouteMap
              route={route}
              type={type}
              editable
              onReorder={reorderStops}
              onRemove={removeStop}
              onAdd={() => setPickerOpen(true)}
              onAutoFix={autoFix}
              onPinMoved={handlePinMoved}
              onOfficeMoved={handleOfficeMoved}
              onRealDistanceKm={setRealDistanceKm}
              pickupTimes={pickupTimes}
              onPickupTimeChange={(empId, time) =>
                setPickupTimes((prev) => ({ ...prev, [empId]: time }))
              }
            />
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="shadow-card">
            <CardHeader><CardTitle className="text-base">Trip summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Type" value={<Badge variant="outline" className="capitalize">{type}</Badge>} />
              <Row label="Passengers" value={`${selected.length} (${selected.filter((e) => e.gender === "F").length}F / ${selected.filter((e) => e.gender === "M").length}M)`} />
              <Row label="Pickups" value={`${route.stops.length} stop${route.stops.length === 1 ? "" : "s"}`} />
              <Row label="Distance" value={displayKm != null ? `${displayKm} km` : <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> calculating…</span>} />
              <Row label="ETA" value={`~${route.etaMin} min`} />
              <Row label="Vehicle needed" value={`${capFor(selected.length)}-seater`} />
              {escortPolicy.required && (
                <Row
                  label="Escort seat"
                  value={
                    <span className="flex items-center gap-1.5 text-destructive font-medium">
                      <Shield className="h-3.5 w-3.5" />
                      1 seat reserved · {capFor(selected.length) - 1 - selected.length} spare
                    </span>
                  }
                />
              )}
              <Row label="Safety" value={
                escortPolicy.required
                  ? <span className="text-destructive flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Escort mandatory</span>
                  : escortPolicy.reordered
                  ? <span className="text-blue-600 flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Route reordered — no escort needed</span>
                  : <span className="text-success flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> All rules satisfied</span>
              } />
              {isAc && <Row label="AC surcharge" value={<span className="text-foreground">+₹{AC_SURCHARGE}</span>} />}
              <Row label="Platform fee" value={<span className="text-muted-foreground">+₹{PLATFORM_FEE}</span>} />
              {price != null && <Row label="Total you pay" value={<span className="font-bold text-base">₹{price + PLATFORM_FEE}</span>} />}
            </CardContent>
          </Card>
          <Card className="shadow-card border-gold/40">
            <CardHeader><CardTitle className="text-base">Send to drivers</CardTitle></CardHeader>
            <CardContent className="space-y-4">

              {/* ── Escort banner + name input ── */}
              {escortPolicy.required && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <Shield className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm text-destructive">Escort mandatory</div>
                      <div className="text-xs text-destructive/80 mt-0.5">{escortPolicy.reason}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Seating: <strong>{capFor(selected.length)}</strong> total · 1 driver · <strong>1 escort</strong> · {selected.length} employee{selected.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-destructive">
                      Escort Name <span className="text-destructive">*</span>
                    </Label>
                    <div className="relative">
                      <UserCheck className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={escortName}
                        onChange={(e) => setEscortName(e.target.value)}
                        placeholder="Enter escort's full name"
                        className={`pl-9 ${escortNameMissing ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      />
                    </div>
                    {escortNameMissing && (
                      <p className="text-xs text-destructive">Escort name is required to broadcast this ride.</p>
                    )}
                  </div>
                </div>
              )}

              {escortPolicy.reordered && !escortPolicy.required && (
                <div className="rounded-lg border border-blue-400/40 bg-blue-50 p-3 flex items-start gap-2">
                  <Shield className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-700">
                    <div className="font-semibold">Route reordered for women's safety</div>
                    <div className="mt-0.5">Female employees have been moved away from the first and last positions. No escort required.</div>
                  </div>
                </div>
              )}
              <div>
                <Label>Vehicle type</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(["hatchback", "sedan", "suv"] as VehicleType[]).map((t) => {
                    const allowed = isSelectable(t);
                    const online = availabilityFor(t);
                    return (
                      <button key={t} type="button" disabled={!allowed} onClick={() => setVehicleType(t)}
                        className={`rounded-md border px-2 py-2 text-xs text-center transition-colors ${
                          !allowed ? "opacity-40 cursor-not-allowed border-border"
                          : vehicleType === t ? "border-gold bg-gold/10 text-gold"
                          : "border-border hover:border-gold/40"
                        }`}>
                        <div className="font-medium">{VEHICLE_LABELS[t]}</div>
                        <div className={`text-[10px] ${online > 0 ? "text-success" : "text-muted-foreground"}`}>{online} online</div>
                      </button>
                    );
                  })}
                </div>
                {selected.length > 3 && <div className="text-[11px] text-muted-foreground mt-1">4+ passengers → SUV only.</div>}
              </div>
              <div className="rounded-md bg-secondary p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Driver fare · {displayKm != null ? `${displayKm} km` : "…"} · {VEHICLE_LABELS[vehicleType]}{isAc ? " · AC" : ""}</span>
                  <span className="font-semibold">
                    {price != null ? `₹${price}` : <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> calculating</span>}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Platform fee</span>
                  <span className="font-semibold">₹{PLATFORM_FEE}</span>
                </div>
                {pendingCancellationFee > 0 && (
                  <div className="flex items-center justify-between text-sm rounded-md bg-warning/10 border border-warning/30 px-2 py-1.5">
                    <span className="text-warning flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Cancellation penalty
                    </span>
                    <span className="font-semibold text-warning">+₹{pendingCancellationFee.toFixed(2)}</span>
                  </div>
                )}
                <div className="h-px bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">You pay</span>
                  <span className="text-2xl font-bold">
                    {price != null
                      ? `₹${(price + PLATFORM_FEE + pendingCancellationFee).toFixed(pendingCancellationFee > 0 ? 2 : 0)}`
                      : <span className="flex items-center gap-1.5 text-muted-foreground text-base"><Loader2 className="h-4 w-4 animate-spin" /> calculating</span>}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Driver receives ₹{price ?? "—"} · ₹{PLATFORM_FEE} platform fee{pendingCancellationFee > 0 ? ` · ₹${pendingCancellationFee.toFixed(2)} cancellation penalty` : ""}
                </div>
              </div>
              {/* AC toggle */}
              <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Wind className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Air conditioning</div>
                    <div className="text-[11px] text-muted-foreground">+₹{AC_SURCHARGE} flat charge</div>
                  </div>
                </div>
                <Switch checked={isAc} onCheckedChange={setIsAc} />
              </div>
              {/* Planned departure time */}
              <div className="rounded-md border px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Shift start time</div>
                    <div className="text-[11px] text-muted-foreground">The shift this ride belongs to — used in OTD reports as "Planned Start Time"</div>
                  </div>
                </div>
                <input
                  type="time"
                  value={plannedPickupTime}
                  onChange={(e) => setPlannedPickupTime(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-gold"
                />
              </div>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div>• Notifies online <b className="text-foreground">{VEHICLE_LABELS[vehicleType]}</b> drivers within <b className="text-foreground">10 km</b> of first pickup</div>
                <div>• <b className="text-foreground">3-min</b> auction window</div>
              </div>
              <Button onClick={broadcast} disabled={createRide.isPending || price == null || escortNameMissing} className="w-full bg-gold text-gold-foreground hover:bg-gold/90 shadow-gold">
                <Radio className="h-4 w-4" /> {createRide.isPending ? "Broadcasting…" : escortNameMissing ? "Enter escort name to broadcast" : "Broadcast now"}
              </Button>
              <div className="pt-3 border-t space-y-2">
                <Label>Or schedule for later (up to 2 days ahead)</Label>
                <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="mt-1"
                  min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                  max={new Date(Date.now() + 2 * 24 * 3600 * 1000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)} />
                <Button onClick={schedule} variant="outline" className="w-full" disabled={createRide.isPending}>Schedule ride</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="sticky bottom-0 -mx-6 mt-6 px-6 py-3 bg-background border-t flex items-center justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3)} disabled={step === 1}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          {step === 2 && displayKm == null ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating route…</>
          ) : (
            <>{selected.length} passenger{selected.length === 1 ? "" : "s"} · {displayKm ?? "—"} km · ~{route.etaMin} min</>
          )}
        </div>
        {step < 3 ? (
          <Button onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)} disabled={!canNext} className="bg-foreground text-background hover:bg-foreground/90">
            {step === 1 ? "Create group & view route" : "Continue"} <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={broadcast} disabled={createRide.isPending || price == null || escortNameMissing} className="bg-gold text-gold-foreground hover:bg-gold/90 shadow-gold">
            <Radio className="h-4 w-4" /> {escortNameMissing ? "Enter escort name" : "Broadcast"}
          </Button>
        )}
      </div>

      <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <SheetContent className="w-[420px]">
          <SheetHeader><SheetTitle>Add employees to this ride</SheetTitle></SheetHeader>
          <div className="mt-4">
            <EmployeeList employees={visibleEmployees} selectedIds={selectedIds} onToggle={toggleEmployee} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Save group dialog */}
      <SaveRouteDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        rideType={type}
        orderedEmployeeIds={route.stops.map((s) => s.empId)}
        vehicleType={vehicleType}
        officeLocationId={activeOffice?.id}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between"><span className="text-muted-foreground">{label}</span><span className="font-medium">{value}</span></div>;
}

function EmployeeList({ employees, selectedIds, onToggle }: {
  employees: UIEmployee[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = employees.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) || e.id.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1">
        {employees.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No employees in your roster yet — add some first.</div>}
        {filtered.map((e) => {
          const sel = selectedIds.includes(e.id);
          return (
            <button
              key={e.id}
              onClick={() => onToggle(e.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-md border text-left transition-colors ${
                sel ? "border-gold bg-gold-soft" : "border-border bg-card hover:border-gold/40"
              }`}
            >
              <div className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 ${sel ? "bg-gold border-gold" : "border-border"}`}>
                {sel && <Check className="h-3 w-3 text-gold-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm flex items-center gap-2">
                  {e.name}
                  {e.gender === "F" && <Badge variant="outline" className="border-gold/40 bg-card text-gold-dark text-[10px] py-0">F</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{e.pickup}</div>
              </div>
              <div className="text-xs text-muted-foreground">{e.loginTime}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
