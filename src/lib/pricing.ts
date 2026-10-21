// Client-side mirror of the backend fare engine (backend is authoritative on
// ride creation). MUST be kept in sync with backend/src/lib/pricing.ts.
//
// Distance-band flat fare (+ per-km beyond 20 km).
//
// Bands (flat price for the whole trip within the band; top band is ₹/km):
//   0–13 → ₹550 (min fare) | 14–15 → ₹600 | 16–18 → ₹650 | 19–20 → ₹700 | 20+ → ₹35/km
// Edges resolve "up to and including": 15 km → ₹600, 18 → ₹650, 20 → ₹700, >20 → ₹35/km.
// Vehicle surcharge (₹/km): hatchback ₹0 | sedan ₹0 | SUV ₹5
// AC option: flat ₹100 surcharge
//
// Example: 22 km, SUV, AC = 22×₹35 + 22×₹5 + ₹100 = ₹980

export type VehicleType = "hatchback" | "sedan" | "suv";

/**
 * Distance-band fare. Each band up to `upTo` km is a FLAT price for the trip;
 * the final open-ended band bills per km across the whole distance.
 */
const SLABS: { upTo: number; flat?: number; perKm?: number }[] = [
  { upTo: 13,       flat: 550 },
  { upTo: 15,       flat: 600 },
  { upTo: 18,       flat: 650 },
  { upTo: 20,       flat: 700 },
  { upTo: Infinity, perKm: 35 },
];

export const VEHICLE_SURCHARGE: Record<VehicleType, number> = { hatchback: 0, sedan: 0, suv: 5 };
export const VEHICLE_LABELS: Record<VehicleType, string> = { hatchback: "Hatchback", sedan: "Sedan", suv: "SUV" };
export const VEHICLE_TYPES: VehicleType[] = ["hatchback", "sedan", "suv"];
export const AC_SURCHARGE = 100;
/** Manual fare top-up options the supervisor can pick at booking time (₹). */
export const FARE_ADJUSTMENT_OPTIONS = [50, 75, 100, 125, 150] as const;
/** Minimum fare floor — no ride is priced below this regardless of distance */
export const MINIMUM_FARE = 550;
/** Escort charge rate — 50% of driver fare, added when escort is mandatory */
export const ESCORT_CHARGE_RATE = 0.5;

/**
 * Escort surcharge = 50% of the driver fare (after minimum floor).
 */
export function escortCharge(driverFare: number): number {
  return Math.round(driverFare * ESCORT_CHARGE_RATE * 100) / 100;
}

/**
 * Base distance fare: a flat band price, or ₹/km across the whole distance for
 * the open-ended top band.
 */
export function distanceFare(km: number): number {
  const distance = Math.max(0, km);
  const slab = SLABS.find((s) => distance <= s.upTo) ?? SLABS[SLABS.length - 1];
  return slab.perKm != null ? distance * slab.perKm : (slab.flat ?? 0);
}

/**
 * Full fare = MAX(minimum fare, base distance fare + vehicle surcharge) + optional AC flat charge.
 */
export function computeFare(km: number, vehicleType?: VehicleType | null, isAc?: boolean): number {
  const base = distanceFare(km);
  const vehicleSurcharge = vehicleType ? VEHICLE_SURCHARGE[vehicleType] * km : 0;
  const acCharge = isAc ? AC_SURCHARGE : 0;
  return Math.round(Math.max(MINIMUM_FARE, base + vehicleSurcharge) + acCharge);
}

// 1–3 pax → any vehicle; 4+ → SUV only.
export function allowedVehicleTypes(pax: number): VehicleType[] {
  return pax <= 3 ? ["hatchback", "sedan", "suv"] : ["suv"];
}
