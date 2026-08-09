// Ride pricing: direct-slab distance fare + per-km vehicle-type surcharge
// + optional AC flat charge.
//
// The ENTIRE distance is billed at the single rate for the slab it falls into
// (not marginal/tiered). Slabs:
//   0–10 km  : ₹50/km
//   11–15 km : ₹45/km
//   16–20 km : ₹40/km
//   21–25 km : ₹35/km
//   26–30 km : ₹30/km
//   31+ km   : ₹30/km
//
// Vehicle surcharge (₹/km, applied on the whole distance):
//   hatchback: ₹0/km  |  sedan: ₹0/km  |  suv: ₹5/km
//
// AC option: flat ₹100 surcharge when isAc = true.
//
// Example: 22 km, SUV, AC
//   base      = 22 × ₹35          = ₹770
//   surcharge = 22 × ₹5           = ₹110
//   AC        =                     ₹100
//   total     =                     ₹980

export type VehicleType = 'hatchback' | 'sedan' | 'suv';

/** Slab boundaries: if km <= upTo, use this rate for the whole distance. */
const SLABS: { upTo: number; rate: number }[] = [
  { upTo: 10,       rate: 50 },
  { upTo: 15,       rate: 45 },
  { upTo: 20,       rate: 40 },
  { upTo: 25,       rate: 35 },
  { upTo: 30,       rate: 30 },
  { upTo: Infinity, rate: 30 },
];

export const VEHICLE_SURCHARGE: Record<VehicleType, number> = {
  hatchback: 0,
  sedan: 0,
  suv: 5,
};

export const AC_SURCHARGE = 100;

/** Manual fare top-up options the supervisor can pick at booking time (₹). */
export const FARE_ADJUSTMENT_OPTIONS = [50, 75, 100, 125, 150] as const;

/** Platform fee added on top of driver fare — shown to supervisor, kept by platform */
export const PLATFORM_FEE = 20;

/** Minimum fare floor — no ride is priced below this regardless of distance */
export const MINIMUM_FARE = 500;

/** Escort charge rate — 50% of driver fare, added when escort is mandatory */
export const ESCORT_CHARGE_RATE = 0.5;

/**
 * Escort surcharge = 50% of the driver fare.
 */
export function escortCharge(driverFare: number): number {
  return Math.round(driverFare * ESCORT_CHARGE_RATE * 100) / 100;
}

/**
 * Base distance fare: whole distance billed at the slab rate it falls into.
 */
export function distanceFare(km: number): number {
  const distance = Math.max(0, km);
  const slab = SLABS.find((s) => distance <= s.upTo) ?? SLABS[SLABS.length - 1];
  return distance * slab.rate;
}

/**
 * Full fare = MAX(minimum fare, base distance fare + vehicle surcharge) + optional AC flat charge.
 * The AC surcharge is applied after the minimum floor so it always adds on top.
 */
export function computeFare(
  km: number,
  vehicleType?: VehicleType | null,
  isAc?: boolean,
): number {
  const base = distanceFare(km);
  const vehicleSurcharge = vehicleType ? (VEHICLE_SURCHARGE[vehicleType] ?? 0) * km : 0;
  const acCharge = isAc ? AC_SURCHARGE : 0;
  const fare = Math.max(MINIMUM_FARE, base + vehicleSurcharge) + acCharge;
  // Exact to 2 decimal places — no rounding to nearest rupee.
  // Razorpay receives this × 100 (paise).
  return Math.round(fare * 100) / 100;
}

// Group-size rule: 1–3 pax → any vehicle; 4+ → SUV only.
export function allowedVehicleTypes(pax: number): VehicleType[] {
  return pax <= 3 ? ['hatchback', 'sedan', 'suv'] : ['suv'];
}
