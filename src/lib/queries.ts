// React Query hooks over the RideOps backend. These replace the mock store as
// the data source for real-data pages.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "@/lib/api";
import { getPoint, DROP } from "@/lib/geo";

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalRides: number;
  activeDrivers: number;
  totalVendors: number;
  totalRevenue: number;
  ridesByStatus: Record<string, number>;
}

export function useAnalyticsOverview() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: () => api<AnalyticsOverview>("/analytics/overview"),
    refetchInterval: 15_000,
  });
}

export interface RideAnalytics {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  totalRevenue: number;
  averagePrice: number;
  completedCount: number;
}

export function useRideAnalytics() {
  return useQuery({
    queryKey: ["analytics", "rides"],
    queryFn: () => api<RideAnalytics>("/analytics/rides"),
    refetchInterval: 30_000,
  });
}

// ─── Payouts ─────────────────────────────────────────────────────────────────

export interface PayoutRow {
  id: string;
  vendorId: string;
  period: string;
  amount: number;
  ratePerRide?: number | null;
  fileUrl?: string | null;
  rideCount?: number;
  status: "pending" | "paid";
  paidAt: string | null;
  createdAt: string;
  vendor?: { name: string };
}

export function usePayouts() {
  return useQuery({
    queryKey: ["payouts"],
    queryFn: () => api<{ payouts: PayoutRow[]; total: number }>("/payouts"),
  });
}

export interface VendorStats {
  vendorId: string;
  vendorName: string;
  totalDrivers: number;
  activeDrivers: number;
  totalRides: number;
  completedRides: number;
  totalRevenue: number;
  pendingPayoutAmount: number;
}

export interface SupervisorOffice {
  org: string | null;
  phone: string | null;
  officeLat: number | null;
  officeLng: number | null;
  officeAddress: string | null;
  facility: string | null;
  pendingCancellationFee: number;
}

export interface OfficeLocationRow {
  id: string;
  supervisorId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isDefault: boolean;
  gracePeriodSecs: number;
  createdAt: string;
}

export function useSupervisorOffice() {
  return useQuery({ queryKey: ["supervisorOffice"], queryFn: () => api<SupervisorOffice>("/supervisor/office") });
}

export function useSetSupervisorPhone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) => api("/supervisor/phone", { method: "PATCH", body: JSON.stringify({ phone }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supervisorOffice"] }),
  });
}

export function useSetFacility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (facility: string) => api("/supervisor/facility", { method: "PATCH", body: JSON.stringify({ facility }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supervisorOffice"] }),
  });
}

export function useSetSupervisorOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { lat: number; lng: number; address: string }) =>
      api("/supervisor/office", { method: "PATCH", body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["supervisorOffice"] }),
  });
}

// ─── Multiple office locations ────────────────────────────────────────────────

export function useOfficeLocations() {
  return useQuery({
    queryKey: ["officeLocations"],
    queryFn: () => api<{ offices: OfficeLocationRow[] }>("/supervisor/offices"),
  });
}

export function useCreateOfficeLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { name: string; address: string; lat: number; lng: number; isDefault?: boolean; gracePeriodSecs?: number }) =>
      api<OfficeLocationRow>("/supervisor/offices", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["officeLocations"] });
      qc.invalidateQueries({ queryKey: ["supervisorOffice"] });
    },
  });
}

export function useUpdateOfficeLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<OfficeLocationRow> & { id: string }) =>
      api<OfficeLocationRow>(`/supervisor/offices/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["officeLocations"] });
      qc.invalidateQueries({ queryKey: ["supervisorOffice"] });
    },
  });
}

export function useDeleteOfficeLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/supervisor/offices/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["officeLocations"] });
      qc.invalidateQueries({ queryKey: ["supervisorOffice"] });
    },
  });
}

// ─── Route Templates ──────────────────────────────────────────────────────────

export interface RouteTemplateRow {
  id: string;
  supervisorId: string;
  name: string;
  rideType: "login" | "logout";
  vehicleType?: string | null;
  officeLocationId?: string | null;
  orderedEmployeeIds: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  officeLocation?: { name: string; address: string; lat: number; lng: number } | null;
}

export function useRouteTemplates() {
  return useQuery({
    queryKey: ["routeTemplates"],
    queryFn: () => api<{ templates: RouteTemplateRow[] }>("/supervisor/route-templates"),
  });
}

export function useCreateRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: {
      name: string;
      rideType: "login" | "logout";
      vehicleType?: string;
      officeLocationId?: string;
      orderedEmployeeIds: string[];
    }) => api<RouteTemplateRow>("/supervisor/route-templates", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routeTemplates"] }),
  });
}

export function useUpdateRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<RouteTemplateRow> & { id: string; markUsed?: boolean }) =>
      api<RouteTemplateRow>(`/supervisor/route-templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routeTemplates"] }),
  });
}

export function useDeleteRouteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/supervisor/route-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["routeTemplates"] }),
  });
}

export function useVendorStats(vendorId: string | null) {
  return useQuery({
    queryKey: ["vendorStats", vendorId],
    queryFn: () => api<VendorStats>(`/vendors/${vendorId}/stats`),
    enabled: !!vendorId,
  });
}

export function useCreatePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { vendorId: string; period: string; ratePerRide: number }) =>
      api<PayoutRow>("/payouts", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payouts"] }),
  });
}

// Admin manually attaches an invoice/proof file to an existing payout (in the table).
export function useAttachPayoutFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      return api<PayoutRow>(`/payouts/${id}/file`, { method: "PATCH", body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payouts"] }),
  });
}

// Period-scoped completed-ride count for a vendor (drives payout auto-calc).
export function useVendorRideCount(vendorId: string | null, period: string) {
  return useQuery({
    queryKey: ["vendorRideCount", vendorId, period],
    queryFn: () => api<{ rides: number }>(`/payouts/ride-count?vendorId=${vendorId}&period=${period}`),
    enabled: !!vendorId && /^\d{4}-\d{2}$/.test(period),
  });
}

export function useMarkPayoutPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/payouts/${id}/status`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payouts"] }),
  });
}

// ─── Safety incidents ────────────────────────────────────────────────────────

export interface IncidentRow {
  id: string;
  rideId: string;
  reportedBy: string;
  description: string;
  status: "open" | "investigating" | "resolved" | "closed";
  createdAt: string;
}

export function useIncidents() {
  return useQuery({
    queryKey: ["incidents"],
    queryFn: () => api<{ incidents: IncidentRow[]; total: number }>("/safety/incidents"),
  });
}

export function useUpdateIncidentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: IncidentRow["status"] }) =>
      api(`/safety/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incidents"] }),
  });
}

// ─── Rides ──────────────────────────────────────────────────────────────────

export type RideStatus =
  | "pending"
  | "broadcasting"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "expired"
  | "scheduled";

export interface RideRow {
  id: string;
  type: "login" | "logout" | "scheduled";
  status: RideStatus;
  pickupAddress: string;
  dropAddress: string;
  price: number | null;
  platformFee?: number | null;
  totalAmount?: number | null;
  escortRequired?: boolean;
  escortCharge?: number | null;
  escortName?: string | null;
  paymentStatus?: string | null;
  distanceKm: number | null;
  paxCount: number;
  capacity: number;
  createdAt: string;
  scheduledFor: string | null;
  broadcastExpiresAt?: string | null;
  /** Planned departure / employee login time (ISO) — shown on the offer card. */
  plannedStartTime?: string | null;
  /** First stop's supervisor-set pickup time (HH:MM) — shown on the offer card. */
  firstPickupTime?: string | null;
  claimedAt?: string | null;
  driverId: string | null;
  vendorId: string | null;
  /** Extracted from PostGIS drop_point — present on GET /rides/:id responses */
  dropLat?: number | null;
  dropLng?: number | null;
  /** Extracted from PostGIS pickup_point — present on GET /rides/:id and /driver/offers */
  pickupLat?: number | null;
  pickupLng?: number | null;
  supervisor?: { fullName: string; email: string };
  driver?: { fullName: string; phone: string } | null;
  rideEmployees?: { employee: { id: string; name: string; empId: string } }[];
}

export interface CreateRidePayload {
  type: "login" | "logout" | "scheduled";
  pickupPoint: { lat: number; lng: number };
  dropPoint: { lat: number; lng: number };
  pickupAddress: string;
  dropAddress: string;
  employeeIds: string[];
  scheduledFor?: string;
  capacity?: number;
  distanceKm?: number;
  vehicleType?: "hatchback" | "sedan" | "suv";
  /** AC flat surcharge option (₹100 added server-side). */
  isAc?: boolean;
  /** Manual fare top-up the supervisor picks at booking time — one of FARE_ADJUSTMENT_OPTIONS. */
  fareAdjustment?: number;
  scheduled?: boolean;
  /** Per-employee expected pickup times — empId → HH:MM */
  scheduledPickupTimes?: Record<string, string>;
  /** Planned departure time (ISO) — stored for OTD reporting */
  plannedStartTime?: string;
  /** Women's safety escort */
  escortRequired?: boolean;
  escortName?: string | null;
}

export interface VehicleOption {
  type: "hatchback" | "sedan" | "suv";
  allowed: boolean;
  availableCount: number;
}

export function useVehicleOptions(lat?: number, lng?: number, pax?: number) {
  return useQuery({
    queryKey: ["vehicle-options", lat, lng, pax],
    queryFn: () => api<{ options: VehicleOption[] }>(`/rides/vehicle-options?lat=${lat}&lng=${lng}&pax=${pax}`),
    enabled: lat != null && lng != null && !!pax,
    refetchInterval: 15_000,
  });
}

export function useCreateRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRidePayload) =>
      api<{ ride: { id: string; status: string }; nearbyCount: number }>("/rides", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rides"] }),
  });
}

// ─── Routing (Google Routes API, server-proxied) ───────────────────────────

export interface OptimizeRouteStopInput {
  empId: string;
  lat: number;
  lng: number;
}

export interface OptimizedStop extends OptimizeRouteStopInput {
  seq: number;
}

export interface RouteLeg {
  /** Real driving distance for the leg reaching this stop, in km. */
  distanceKm: number;
  /** Traffic-aware duration for the leg reaching this stop, in minutes. */
  durationMin: number;
}

export interface OptimizeRouteResult {
  stops: OptimizedStop[];
  totalDistanceKm: number;
  etaMin: number;
  encodedPolyline: string | null;
  /** Per-leg real driving distance/duration, one entry per stop in final order. */
  legs: RouteLeg[];
  /** Drive into the office (login only; null for logout). */
  officeLeg: RouteLeg | null;
}

/**
 * Orders the given stops for efficiency via the backend (Google Routes API —
 * real driving distance + traffic-aware ETA, not straight-line Haversine).
 * No gender/safety logic — see escortPolicy.ts for the safety check, which
 * runs separately against whatever the final order ends up being.
 */
export function useOptimizeRoute() {
  return useMutation({
    mutationFn: (payload: { type: "login" | "logout"; office: { lat: number; lng: number }; stops: OptimizeRouteStopInput[]; optimize?: boolean }) =>
      api<OptimizeRouteResult>("/routing/optimize", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });
}

export interface ComputeRouteResult {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
  legs: Array<{ distanceMeters: number; durationSeconds: number }>;
}

/**
 * Real driving distance/duration for a FIXED sequence of stops (never
 * reordered) — e.g. driver's current GPS -> remaining pax stops -> office,
 * for live ride tracking. Returns a per-leg breakdown.
 */
export function useComputeRoute() {
  return useMutation({
    mutationFn: (payload: { origin: { lat: number; lng: number }; destination: { lat: number; lng: number }; intermediates?: { lat: number; lng: number }[] }) =>
      api<ComputeRouteResult>("/routing/route", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });
}

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  routeExists: boolean;
}

/**
 * Real driving distance + traffic-aware duration for every (origin,
 * destination) pair — e.g. "driver's distance from the next pickup stop".
 * Replaces flat Haversine + assumed-speed ETA guesses.
 */
export function useRouteMatrix() {
  return useMutation({
    mutationFn: (payload: { origins: { lat: number; lng: number }[]; destinations: { lat: number; lng: number }[] }) =>
      api<{ elements: RouteMatrixElement[] }>("/routing/matrix", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });
}

export function useCancelRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/rides/${id}/cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rides"] }),
  });
}

/** Force-cancel a ride regardless of status — used in SOS context only. */
export function useForceCancelRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/rides/${id}/force-cancel`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rides"] }),
  });
}

export interface SosRebookResult {
  newRideId: string;
  newRideStatus: string;
  nearbyCount: number;
  employeeCount: number;
}

/**
 * Cancel the SOS ride and auto-create a new one for remaining passengers
 * starting from the driver's current GPS. Broadcasts immediately.
 */
export function useSosRebook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (issueId: string) =>
      api<SosRebookResult>(`/issues/${issueId}/sos-rebook`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rides"] });
      qc.invalidateQueries({ queryKey: ["issues"] });
    },
  });
}

export function useRebroadcastRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/rides/${id}/rebroadcast`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rides"] }),
  });
}

export function useAdvanceRideStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: RideStatus }) =>
      api(`/rides/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rides"] });
      qc.invalidateQueries({ queryKey: ["driver"] });
    },
  });
}

// ─── Driver app ───────────────────────────────────────────────────────────────

export interface DriverProfile {
  id: string;
  fullName: string;
  phone: string;
  altPhone?: string | null;
  status: string;
  kycStatus: string;
  isOnline: boolean;
  rating: number;
  vehicleType?: string | null;
  seats?: number | null;
  walletBalance?: number;
  // Licence / ID details
  dlNumber?: string | null;
  dlExpiry?: string | null;
  govIdNumber?: string | null;
  vendor?: { name: string; vendorCode?: string };
  vehicle?: { regNo: string; capacity: number; fuelType: string } | null;
  /** Document types that are verified but have expired. */
  expiredDocTypes?: string[];
}

export function useDriverMe() {
  return useQuery({ queryKey: ["driver", "me"], queryFn: () => api<DriverProfile>("/driver/me") });
}

export function useSetDriverVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { vehicleType: string; seats: number }) =>
      api("/driver/vehicle", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export function useDriverOffers() {
  return useQuery({
    queryKey: ["driver", "offers"],
    // `offers` is capped server-side (soonest-expiring first); `totalCount`
    // is the uncapped total, used to show "N available" on the Rides tab.
    queryFn: () => api<{ offers: RideRow[]; totalCount: number }>("/driver/offers"),
    refetchInterval: 8_000,
  });
}

export function useDriverRides() {
  return useQuery({
    queryKey: ["driver", "rides"],
    queryFn: () => api<Paginated<RideRow>>("/driver/rides"),
    refetchInterval: 8_000,
  });
}

export function useGoOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (loc: { lat: number; lng: number }) => api("/driver/online", { method: "POST", body: JSON.stringify(loc) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

/** Driver slides the "I've arrived" confirmation — stamps driver_reporting_time once. */
export function useMarkDriverArrived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => api<{ ok: boolean; driverReportingTime: string }>(`/rides/${rideId}/arrived`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

/**
 * Driver drops a ride they already accepted (status 'assigned').
 * The ride goes back to broadcasting for other drivers. A fine applies only if
 * the driver had already confirmed arrival — see DRIVER_DROP_AFTER_ARRIVAL_FINE.
 */
export function useDriverCancelRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, reason }: { rideId: string; reason: string }) =>
      api<{ fine: number; rebroadcast: boolean }>(`/rides/${rideId}/driver-cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export interface LiveDriver {
  id: string;
  fullName: string;
  vehicleType: string | null;
  status: string;
  isOnline: boolean;
  lat: number;
  lng: number;
}

// Admin live cab map — polls online drivers' current GPS positions.
export function useLiveDriverLocations() {
  return useQuery({
    queryKey: ["liveDriverLocations"],
    queryFn: () => api<{ drivers: LiveDriver[] }>("/drivers/live-locations"),
    refetchInterval: 10000,
  });
}

export function useUpdateDriverLocation() {
  return useMutation({
    mutationFn: (loc: { lat: number; lng: number }) => api("/driver/location", { method: "POST", body: JSON.stringify(loc) }),
  });
}

export function useGoOffline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/driver/offline", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export function useAcceptOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => api(`/rides/${rideId}/accept`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export function useRejectOffer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => api(`/rides/${rideId}/reject`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export interface RidePaxRow {
  id: string;
  seq: number;
  name: string;
  gender: string | null;
  lat: number;
  lng: number;
  contactLabel: string;
  contactPhone: string | null;
  scheduledPickupTime?: string | null;
  pickedAt: string | null;
  droppedAt: string | null;
  noShow: boolean;
  pickupOtp?: string;
  dropOtp?: string;
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

// Address-based directions link. Used as a fallback when a stop's PostGIS
// coordinates aren't available (e.g. the ride-detail request hasn't resolved
// yet, or an older ride has no pickup_point) — a driver should never be left
// with no way to navigate, even if it's slightly less precise than coords.
export function mapsUrlForAddress(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
}

// Full multi-stop directions in the given order: origin = driver's current location,
// intermediate stops become ordered waypoints, the final stop is the destination.
// Google keeps the supplied order (we don't pass an optimize flag).
export function multiStopMapsUrl(stops: { lat: number; lng: number }[]): string {
  if (stops.length === 0) return "https://www.google.com/maps";
  if (stops.length === 1) return mapsUrl(stops[0].lat, stops[0].lng);
  const dest = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).map((s) => `${s.lat},${s.lng}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&waypoints=${encodeURIComponent(waypoints)}&travelmode=driving`;
}

export function useRidePax(rideId?: string) {
  return useQuery({
    queryKey: ["ridepax", rideId],
    queryFn: () => api<{
      type: string; escortRequired: boolean; escortName: string | null;
      escortDroppedAt: string | null; escortOtp?: string; // escortOtp only present for supervisor/admin
      pax: RidePaxRow[];
    }>(`/rides/${rideId}/pax`),
    enabled: !!rideId,
    refetchInterval: 6_000,
  });
}

/** Fetch a single ride by id (includes dropLat/dropLng extracted from PostGIS). */
export function useRide(rideId?: string) {
  return useQuery({
    queryKey: ["ride", rideId],
    queryFn: () => api<RideRow>(`/rides/${rideId}`),
    enabled: !!rideId,
    refetchInterval: 10_000,
  });
}

// ─── Completed ride full detail ───────────────────────────────────────────────

export interface RidePassenger {
  seq: number;
  name: string;
  empId: string;
  gender: string;
  phone: string | null;
  pickupAddress: string;
  dropAddress: string;
  pickedAt: string | null;
  droppedAt: string | null;
  noShow: boolean;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  recordedAt: string;
}

export interface RideDetail {
  id: string;
  type: string;
  status: string;
  pickupAddress: string;
  dropAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropLat: number | null;
  dropLng: number | null;
  distanceKm: number | null;
  price: number | null;
  vehicleType: string | null;
  paxCount: number;
  capacity: number;
  createdAt: string;
  completedAt: string | null;
  scheduledFor: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  plannedStartTime: string | null;
  driverReportingTime: string | null;
  supervisor: { fullName: string; email: string; phone: string | null; org: string | null } | null;
  driver: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
    vehicleType: string | null;
    vehicle: { regNo: string; capacity: number; fuelType: string } | null;
  } | null;
  vendor: { name: string } | null;
  passengers: RidePassenger[];
  locationTrail: LocationPoint[];
}

export function useRideDetail(rideId?: string) {
  return useQuery({
    queryKey: ["rideDetail", rideId],
    queryFn: () => api<RideDetail>(`/rides/${rideId}/detail`),
    enabled: !!rideId,
  });
}

export function useVerifyPickup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, paxId, otp }: { rideId: string; paxId: string; otp: string }) =>
      api(`/rides/${rideId}/pax/${paxId}/pickup`, { method: "POST", body: JSON.stringify({ otp }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ridepax"] }); qc.invalidateQueries({ queryKey: ["driver"] }); },
  });
}

export function useVerifyDrop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, paxId, otp }: { rideId: string; paxId: string; otp: string }) =>
      api(`/rides/${rideId}/pax/${paxId}/drop`, { method: "POST", body: JSON.stringify({ otp }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ridepax"] }); qc.invalidateQueries({ queryKey: ["driver"] }); },
  });
}

export function useMarkNoShow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, paxId }: { rideId: string; paxId: string }) =>
      api(`/rides/${rideId}/pax/${paxId}/no-show`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ridepax"] }); qc.invalidateQueries({ queryKey: ["driver"] }); },
  });
}

// Escort return-drop OTP (logout escort rides only) — driver enters the OTP
// the supervisor relayed to them by phone/in person after confirming the
// escort's identity, verifying the escort was dropped back at the office.
export function useVerifyEscortDrop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, otp }: { rideId: string; otp: string }) =>
      api(`/rides/${rideId}/escort-drop`, { method: "POST", body: JSON.stringify({ otp }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ridepax"] }); qc.invalidateQueries({ queryKey: ["driver"] }); },
  });
}

export function useScheduledRides() {
  return useQuery({
    queryKey: ["driver", "scheduled"],
    queryFn: () => api<{ scheduled: RideRow[] }>("/driver/scheduled"),
    refetchInterval: 10_000,
  });
}

export function useClaimRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => api(`/rides/${rideId}/claim`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export function useReleaseRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) => api<{ fine: number }>(`/rides/${rideId}/release`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver"] }),
  });
}

export interface NearbyDriver {
  id: string;
  fullName: string;
  phone: string;
  rating: number;
  vehicleType: string | null;
  isOnline: boolean;
  regNo: string | null;
  capacity: number | null;
  fuelType: string | null;
  distanceKm: number;
}

export function useNearbyDrivers(rideId: string | null, radius: number, enabled: boolean) {
  return useQuery({
    queryKey: ["nearbyDrivers", rideId, radius],
    queryFn: () => api<{ drivers: NearbyDriver[] }>(`/rides/${rideId}/nearby-drivers?radius=${radius}`),
    enabled: !!rideId && enabled,
    staleTime: 0,        // always fetch fresh — never use cached nearby list
    gcTime: 0,           // don't keep in cache after component unmounts
  });
}

export function useAssignRide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, driverId, price }: { rideId: string; driverId: string; price?: number }) =>
      api(`/rides/${rideId}/assign`, { method: "POST", body: JSON.stringify({ driverId, ...(price ? { price } : {}) }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rides"] }),
  });
}

// ─── Driver issues (supervisor -> vendor + admin) ───────────────────────────

export interface IssueRow {
  id: string;
  supervisorId: string;
  driverId: string;
  vendorId: string;
  rideId?: string | null;
  description: string;
  issueType?: string | null;
  isSos?: boolean;
  status: "open" | "resolved";
  createdAt: string;
  driver?: { fullName: string; phone: string };
  supervisor?: { fullName: string; org: string | null; phone?: string | null };
  vendor?: { name: string };
  ride?: { pickupAddress: string; dropAddress: string; type: string; price: number | null; distanceKm: number | null; createdAt: string } | null;
}

export function useIssues() {
  return useQuery({ queryKey: ["issues"], queryFn: () => api<{ issues: IssueRow[] }>("/issues"), refetchInterval: 20_000 });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { rideId: string; description: string }) => api<IssueRow>("/issues", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

export type SosIssueType = "vehicle_issue" | "medical_emergency" | "other";

/** Driver creates a SOS alert — resolves supervisor from active ride. */
export function useCreateDriverSos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { issueType: SosIssueType; description: string; rideId?: string }) =>
      api<IssueRow>("/issues/sos", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driverSos"] }),
  });
}

/** Fetch the driver's own SOS issues. */
export function useDriverSosIssues() {
  return useQuery({
    queryKey: ["driverSos"],
    queryFn: () => api<{ issues: IssueRow[] }>("/issues"),
    refetchInterval: 10_000,
  });
}

export interface IssueMessageRow {
  id: string;
  issueId: string;
  senderId: string;
  senderRole: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export function useIssueMessages(issueId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["issueMessages", issueId],
    queryFn: () => api<{ messages: IssueMessageRow[] }>(`/issues/${issueId}/messages`),
    enabled: !!issueId && enabled,
    refetchInterval: 5_000,
  });
}

export function useSendIssueMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, body }: { issueId: string; body: string }) =>
      api<IssueMessageRow>(`/issues/${issueId}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    onSuccess: (_res, v) => qc.invalidateQueries({ queryKey: ["issueMessages", v.issueId] }),
  });
}

export function useUpdateIssueStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "resolved" }) => api(`/issues/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["issues"] }),
  });
}

// ─── Documents (KYC / vehicle) ──────────────────────────────────────────────

export interface DocumentRow {
  id: string;
  driverId: string;
  type: string;
  fileUrl: string;
  number: string | null;
  expiry: string | null;
  status: "pending" | "verified" | "rejected";
  rejectionNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
}

// Appends a short-lived access token so files render in <img>/<a>.
export function fileSrc(fileUrl: string): string {
  return `${fileUrl}?token=${tokenStore.access ?? ""}`;
}

export function useDriverDocuments() {
  return useQuery({ queryKey: ["driver", "documents"], queryFn: () => api<{ documents: DocumentRow[] }>("/driver/documents") });
}

export function useUploadDriverDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api<DocumentRow>("/driver/documents", { method: "POST", body: form }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver", "documents"] }),
  });
}

export function useDeleteDriverDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/driver/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driver", "documents"] }),
  });
}

export function useDriverDocsForVendor(driverId: string | null) {
  return useQuery({
    queryKey: ["documents", driverId],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/drivers/${driverId}/documents`),
    enabled: !!driverId,
  });
}

export function useSetDocumentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ driverId, docId, status, rejectionNote }: { driverId: string; docId: string; status: DocumentRow["status"]; rejectionNote?: string }) =>
      api(`/drivers/${driverId}/documents/${docId}`, { method: "PATCH", body: JSON.stringify({ status, rejectionNote }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["drivers"] });
      qc.invalidateQueries({ queryKey: ["pendingDocsCount"] });
    },
  });
}

export interface Paginated<T> {
  rides?: T[];
  drivers?: T[];
  vendors?: T[];
  total: number;
  page: number;
  limit: number;
}

export function useRides(params?: { status?: string; limit?: number }) {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : "";
  return useQuery({
    queryKey: ["rides", params ?? {}],
    queryFn: () => api<Paginated<RideRow>>(`/rides${suffix}`),
    refetchInterval: 15_000,
  });
}

// ─── Vendors ──────────────────────────────────────────────────────────────────

export interface VendorRow {
  id: string;
  name: string;
  vendorCode?: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  user?: { email: string; isActive: boolean };
  _count?: { drivers: number; vehicles: number; rides: number };
}

export function useVendors() {
  return useQuery({
    queryKey: ["vendors"],
    queryFn: () => api<Paginated<VendorRow>>("/vendors"),
  });
}

/** Look up a vendor by their Vendor Code (e.g. VND-A1B2C3). Public — no auth required. */
export function useVendorByCode(code: string) {
  return useQuery({
    queryKey: ["vendorByCode", code.toUpperCase()],
    queryFn: () => api<{ id: string; name: string; vendorCode: string }>(
      `/vendors/by-code/${code.toUpperCase()}`,
      { auth: false },
    ),
    enabled: /^VND-[A-Z0-9]{6}$/.test(code.toUpperCase()),
    retry: false,
  });
}

/** Fetches the logged-in vendor user's own vendor record (name + code). */
export function useVendorProfile() {
  return useQuery({
    queryKey: ["vendorProfile"],
    queryFn: () => api<{ id: string; name: string; vendorCode: string }>("/vendor/profile"),
  });
}

export function useCreateVendorAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { company: string; contactName: string; contactEmail: string; contactPhone: string; email: string; password: string }) =>
      api<{ vendorId: string; userId: string; name: string }>("/admin/vendors", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vendors"] }),
  });
}

// ─── Tenants (admin provisions company + supervisor) ────────────────────────

export interface TenantRow {
  id: string;
  email: string;
  fullName: string;
  org: string | null;
  isActive: boolean;
  createdAt: string;
  employeeCount: number;
  rideCount: number;
}

export function useTenants() {
  return useQuery({
    queryKey: ["tenants"],
    queryFn: () => api<{ tenants: TenantRow[] }>("/admin/tenants"),
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { company: string; fullName: string; email: string; password: string }) =>
      api<TenantRow>("/admin/tenants", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants"] }),
  });
}

export function useSetTenantActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api(`/admin/tenants/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenants"] }),
  });
}

// ─── Registration Requests ────────────────────────────────────────────────────

export interface RegistrationRequestRow {
  id: string;
  role: "supervisor" | "vendor";
  fullName: string;
  email: string;
  mobile: string;
  companyName: string;
  gstin?: string | null;
  address: string;
  status: "pending" | "approved" | "rejected";
  reviewNote?: string | null;
  createdAt: string;
  reviewedAt?: string | null;
}

export function useRegistrationRequests(status?: string) {
  const suffix = status ? `?status=${status}` : "";
  return useQuery({
    queryKey: ["registrationRequests", status ?? "all"],
    queryFn: () => api<{ requests: RegistrationRequestRow[] }>(`/admin/registration-requests${suffix}`),
    refetchInterval: 20_000,
  });
}

export function useReviewRegistrationRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reviewNote }: { id: string; decision: "approved" | "rejected"; reviewNote?: string }) =>
      api(`/admin/registration-requests/${id}`, { method: "PATCH", body: JSON.stringify({ decision, reviewNote }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["registrationRequests"] });
      qc.invalidateQueries({ queryKey: ["tenants"] });
      qc.invalidateQueries({ queryKey: ["vendors"] });
    },
  });
}

/** Public — no auth required. Submits a vendor/supervisor account request. */
export function useSubmitRegistrationRequest() {
  return useMutation({
    mutationFn: (payload: {
      role: "supervisor" | "vendor";
      fullName: string;
      email: string;
      password: string;
      mobile: string;
      companyName: string;
      gstin?: string;
      address: string;
    }) => api<{ id: string; message: string }>("/auth/register-request", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    }),
  });
}

// ─── Drivers ──────────────────────────────────────────────────────────────────

export interface DriverRow {
  id: string;
  fullName: string;
  phone: string;
  altPhone?: string | null;
  vendorId: string;
  status: "pending" | "active" | "blacklisted" | "expired";
  kycStatus: "pending" | "approved" | "rejected" | "expired";
  isOnline: boolean;
  rating: number;
  createdAt: string;
  // Licence / ID details
  dlNumber?: string | null;
  dlExpiry?: string | null;
  govIdNumber?: string | null;
  vendor?: { name: string };
  vehicle?: { regNo: string; capacity: number; fuelType: string } | null;
  expiredDocTypes?: string[];
}

export function useDriver(id: string | null) {
  return useQuery({
    queryKey: ["driver", id],
    queryFn: () => api<DriverRow>(`/drivers/${id}`),
    enabled: !!id,
  });
}

export function usePendingDocsCount() {
  return useQuery({
    queryKey: ["pendingDocsCount"],
    queryFn: () => api<{ count: number }>("/drivers/pending-docs-count"),
    refetchInterval: 30_000,
  });
}

export function useUpdateDriverProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { fullName?: string; altPhone?: string | null; dlNumber?: string | null; dlExpiry?: string | null; govIdNumber?: string | null }) =>
      api("/driver/profile", { method: "PATCH", body: JSON.stringify(p) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driver", "me"] });
    },
  });
}

export function useDrivers(params?: { vendorId?: string }) {
  const qs = params?.vendorId ? `?vendorId=${params.vendorId}` : "";
  return useQuery({
    queryKey: ["drivers", params ?? {}],
    queryFn: () => api<Paginated<DriverRow>>(`/drivers${qs}`),
    refetchInterval: 20_000,
  });
}

export function useUpdateDriverStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: DriverRow["status"] }) =>
      api(`/drivers/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drivers"] }),
  });
}

export function useCreateDriver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { phone: string; fullName: string; vehicleId?: string }) =>
      api<DriverRow>("/drivers", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["drivers"] }),
  });
}

// ─── Employees (supervisor) ─────────────────────────────────────────────────

export interface EmployeeRow {
  id: string;
  empId: string;
  name: string;
  gender: string;
  phone: string | null;
  pickupAddress: string;
  dropAddress: string;
  shiftStart: string;
  shiftEnd: string;
  companyLabel?: string | null;
  createdAt: string;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropLat?: number | null;
  dropLng?: number | null;
}

export interface CreateEmployeePayload {
  empId: string;
  name: string;
  gender: "male" | "female" | "other";
  phone?: string;
  pickupLocation: { lat: number; lng: number };
  dropLocation: { lat: number; lng: number };
  pickupAddress: string;
  dropAddress: string;
  shiftStart: string;
  shiftEnd: string;
  companyLabel?: string;
}

// Maps a UI/CSV row (area names, M/F, free-form phone) to the backend payload
// (lat/lng geo points, male/female, normalized phone).
export function buildEmployeePayload(row: {
  empId: string;
  name: string;
  gender: string;
  phone?: string;
  pickup: string;
  drop?: string;
  loginTime: string;
  logoutTime: string;
}): CreateEmployeePayload {
  const pickup = getPoint(row.pickup);
  const dropName = row.drop || DROP;
  const drop = getPoint(dropName);
  const digits = (row.phone ?? "").replace(/[^\d]/g, "");
  return {
    empId: row.empId,
    name: row.name,
    gender: row.gender?.toUpperCase().startsWith("F") ? "female" : "male",
    phone: digits.length >= 10 && digits.length <= 15 ? digits : undefined,
    pickupLocation: { lat: pickup.lat, lng: pickup.lng },
    dropLocation: { lat: drop.lat, lng: drop.lng },
    pickupAddress: row.pickup,
    dropAddress: dropName,
    shiftStart: row.loginTime,
    shiftEnd: row.logoutTime,
  };
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: () => api<{ employees: EmployeeRow[]; total: number }>("/employees"),
  });
}

export function useCreateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEmployeePayload) =>
      api<EmployeeRow>("/employees", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

/** Assign / change an employee's company label (office group). */
export function useUpdateEmployeeCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, companyLabel }: { id: string; companyLabel: string | null }) =>
      api(`/employees/${id}`, { method: "PATCH", body: JSON.stringify({ companyLabel }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

export function useBulkCreateEmployees() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateEmployeePayload[]) =>
      api<{ successCount: number; failCount: number; results: { success: boolean; empId: string; error?: string }[] }>(
        "/employees/bulk",
        { method: "POST", body: JSON.stringify(payload) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });
}

// ─── OTD Report ───────────────────────────────────────────────────────────────

export interface OtdReportRow {
  sNo: number;
  facility: string;
  office: string;
  date: string;
  tripTypeShiftTime: string;
  tripId: string;
  vehicleId: string;
  registrationNo: string;
  vendor: string;
  plannedEmployeeCount: number;
  travelledEmployeeCount: number;
  firstEmployeeSignin: string;
  lastEmployeeSignin: string;
  tripStartDelayMin: number | null;
  tripKm: number | null;
  delayCause: string;
  plannedStartTime: string;
  logoutGraceTimeSecs: number;
  targetTime: string;
  actualStartTime: string;
  driverReportingTime: string;
  lastEmployeeName: string;
  lastEmployeeSigninTime: string;
  price: number | null;
  distanceKm: number | null;
}

export function useOtdReport(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ["otdReport", from, to],
    queryFn: () => api<{ rows: OtdReportRow[]; total: number; from: string; to: string }>(
      `/supervisor/reports/otd?from=${from}&to=${to}`
    ),
    enabled,
    staleTime: 2 * 60 * 1000,
  });
}

// ─── Supervisor Dashboard ─────────────────────────────────────────────────────

export interface SupervisorDashboardData {
  kpis: {
    ridesToday: number;
    ridesThisWeek: number;
    completedThisMonth: number;
    activeRides: number;
    broadcastingRides: number;
    totalEmployees: number;
    spendToday: number;
    spendMonth: number;
    otdPct: number | null;
    openIssues: number;
    sosThisMonth: number;
    employeesCoveredThisWeek: number;
    coveragePct: number;
  };
  otdTrend: Array<{ date: string; otdPct: number; total: number; onTime: number }>;
  delayCounts: { early: number; onTime: number; employee: number; driver: number; noData: number };
  volumeTrend: Array<{ date: string; login: number; logout: number; total: number }>;
  recentIssues: Array<{
    id: string;
    isSos: boolean;
    issueType: string | null;
    description: string;
    createdAt: string;
    driver: { fullName: string } | null;
  }>;
}

export function useSupervisorDashboard() {
  return useQuery({
    queryKey: ["supervisorDashboard"],
    queryFn: () => api<SupervisorDashboardData>("/supervisor/dashboard"),
    refetchInterval: 30_000,
  });
}

// ─── Live Ops Board ───────────────────────────────────────────────────────────

export interface LiveOpsTile {
  count: number;
  total: number;
  female: number;
  male: number;
}

export interface LiveOpsData {
  generated:        LiveOpsTile;
  yetToStart:       LiveOpsTile;
  notDownloaded:    LiveOpsTile;
  onTime:           LiveOpsTile & { onTimePickupPct: number | null };
  delayed:          LiveOpsTile;
  inProgressNoTime: LiveOpsTile;
  completedOnTime:  LiveOpsTile & { otaPct: number | null };
  completedTotal:   LiveOpsTile;
}

export function useLiveOps() {
  return useQuery({
    queryKey: ["liveOps"],
    queryFn: () => api<LiveOpsData>("/supervisor/live-ops"),
    refetchInterval: 15_000,
  });
}

// ─── Saved Groups Report ──────────────────────────────────────────────────────

export interface SavedGroupReportRow {
  id: string;
  name: string;
  rideType: string;
  vehicleType: string | null;
  employeeCount: number;
  officeName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  totalRides: number;
  completedRides: number;
  totalRevenue: number;
  avgFare: number;
}

export function useSavedGroupsReport() {
  return useQuery({
    queryKey: ["savedGroupsReport"],
    queryFn: () => api<{ report: SavedGroupReportRow[] }>("/supervisor/route-templates/report"),
    staleTime: 2 * 60_000,
  });
}

// ─── Supervisor → Driver Payments ─────────────────────────────────────────────

export interface PendingPaymentRide {
  id: string;
  type: string;
  price: number | null;
  platformFee: number | null;
  escortCharge: number | null;
  totalAmount: number | null;
  distanceKm: number | null;
  pickupAddress: string;
  dropAddress: string;
  completedAt: string | null;
  paymentStatus: string;
  driver: {
    id: string;
    fullName: string;
    phone: string;
    walletBalance: number;
    bankDetail: { upiId: string | null; accountNo: string | null; ifsc: string | null; accountName: string | null; verified: boolean } | null;
  } | null;
}

export function usePendingPayments() {
  return useQuery({
    queryKey: ["pendingPayments"],
    queryFn: () => api<{ rides: PendingPaymentRide[] }>("/payments/pending"),
    refetchInterval: 20_000,
  });
}

export interface PaymentInitResult {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  rideId: string;
  driverFare: number;
  escortFee: number;
  platformFee: number;
  cancellationFee: number;
  totalAmount: number;
  fineDeduction: number;
  driverReceives: number;
  driverName: string;
  isMock: boolean;
}

export function useInitiatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rideId: string) =>
      api<PaymentInitResult>(`/payments/rides/${rideId}/initiate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pendingPayments"] }),
  });
}

export function useConfirmPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rideId, razorpayPaymentId, razorpaySignature }: {
      rideId: string;
      razorpayPaymentId: string;
      razorpaySignature?: string;
    }) => api(`/payments/rides/${rideId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ razorpayPaymentId, razorpaySignature }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pendingPayments"] });
      qc.invalidateQueries({ queryKey: ["rides"] });
    },
  });
}

// ─── Driver Wallet ────────────────────────────────────────────────────────────

export interface WalletPayment {
  id: string;
  price: number | null;
  escortCharge: number | null;
  platformFee: number | null;
  paidAt: string | null;
  type: string;
  pickupAddress: string;
  dropAddress: string;
  supervisor: { fullName: string; org: string | null } | null;
}

export function useDriverWallet() {
  return useQuery({
    queryKey: ["driverWallet"],
    queryFn: () => api<{ walletBalance: number; maxWithdrawable: number; payoutFee: number; payments: WalletPayment[] }>("/payments/wallet"),
    refetchInterval: 30_000,
  });
}

export interface DriverBankDetail {
  upiId: string | null;
  accountNo: string | null;
  ifsc: string | null;
  accountName: string | null;
  verified: boolean;
}

export function useDriverBankDetail() {
  return useQuery({
    queryKey: ["driverBankDetail"],
    queryFn: () => api<{ bankDetail: DriverBankDetail | null }>("/payments/bank-detail"),
  });
}

export function useSaveDriverBankDetail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { upiId?: string; accountNo?: string; ifsc?: string; accountName?: string }) =>
      api<{ bankDetail: DriverBankDetail }>("/payments/bank-detail", { method: "POST", body: JSON.stringify(p) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["driverBankDetail"] }),
  });
}

// ─── Driver Payouts (Razorpay X) ──────────────────────────────────────────────

export interface PayoutTransaction {
  id:               string;
  amount:           number;
  fee:              number;
  totalDeducted:    number;
  mode:             string;
  status:           'processing' | 'processed' | 'failed' | 'reversed';
  razorpayPayoutId: string | null;
  utr:              string | null;
  createdAt:        string;
}

export interface WithdrawResult {
  ok:               boolean;
  amount:           number;
  fee:              number;
  totalDeducted:    number;
  mode:             string;
  payoutId:         string;
  status:           string;
  newWalletBalance: number;
  isMock?:          boolean;
}

export function useWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) =>
      api<WithdrawResult>("/payments/driver/withdraw", { method: "POST", body: JSON.stringify({ amount }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["driverWallet"] });
      qc.invalidateQueries({ queryKey: ["driverPayouts"] });
      qc.invalidateQueries({ queryKey: ["driver"] });
    },
  });
}

export function useDriverPayouts() {
  return useQuery({
    queryKey: ["driverPayouts"],
    queryFn: () => api<{ payouts: PayoutTransaction[]; payoutFee: number }>("/payments/driver/payouts"),
    refetchInterval: 30_000,
  });
}

// ─── Driver live location for a ride ─────────────────────────────────────────

export function useRideDriverLocation(rideId: string | undefined) {
  return useQuery({
    queryKey: ["rideDriverLocation", rideId],
    queryFn: () => api<{ lat: number | null; lng: number | null }>(`/rides/${rideId}/driver-location`),
    enabled: !!rideId,
    refetchInterval: 8_000, // fallback polling if socket misses
    staleTime: 0,
  });
}
