// Client-side mirror of the backend fare engine (backend is authoritative on
// ride creation). MUST be kept in sync with backend/src/lib/pricing.ts.
//
// Direct-slab fare: the ENTIRE distance is billed at the single rate for the
// slab it falls into (not marginal/tiered).
//
// Slabs:  0–10 km → ₹50/km | 11–15 → ₹45 | 16–20 → ₹40 | 21–25 → ₹35 | 26+ → ₹30
// Vehicle surcharge (₹/km): hatchback ₹3 | sedan ₹5 | SUV ₹7
// AC option: flat ₹100 surcharge
//
// Example: 22 km, SUV, AC = 22×₹35 + 22×₹7 + ₹100 = ₹1,024

export type VehicleType = "hatchback" | "sedan" | "suv";

/** Slab boundaries: if km <= upTo, use this rate for the whole distance. */
const SLABS: { upTo: number; rate: number }[] = [
  { upTo: 10,       rate: 50 },
  { upTo: 15,       rate: 45 },
  { upTo: 20,       rate: 40 },
  { upTo: 25,       rate: 35 },
  { upTo: 30,       rate: 30 },
  { upTo: Infinity, rate: 30 },
];

export const VEHICLE_SURCHARGE: Record<VehicleType, number> = { hatchback: 3, sedan: 5, suv: 7 };
export const VEHICLE_LABELS: Record<VehicleType, string> = { hatchback: "Hatchback", sedan: "Sedan", suv: "SUV" };
export const VEHICLE_TYPES: VehicleType[] = ["hatchback", "sedan", "suv"];
export const AC_SURCHARGE = 100;
/** Platform fee added on top of driver fare — shown to supervisor, kept by platform */
export const PLATFORM_FEE = 20;
/** Minimum fare floor — no ride is priced below this regardless of distance */
export const MINIMUM_FARE = 500;

/**
 * Base distance fare: whole distance billed at the single slab rate.
 */
export function distanceFare(km: number): number {
  const distance = Math.max(0, km);
  const slab = SLABS.find((s) => distance <= s.upTo) ?? SLABS[SLABS.length - 1];
  return distance * slab.rate;
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
