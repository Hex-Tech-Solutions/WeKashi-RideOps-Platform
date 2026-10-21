// Ride pricing: distance-band flat fare (+ per-km beyond 20 km) + per-km
// vehicle-type surcharge + optional AC flat charge.
//
// Bands (flat price for the whole trip within the band):
//   0–13 km  : ₹550  (also the minimum fare)
//   14–15 km : ₹600
//   16–18 km : ₹650
//   19–20 km : ₹700
//   20+  km  : ₹35/km   (billed on the whole distance)
//
// Band edges resolve "up to and including": a 15.0 km trip is ₹600, 18.0 km is
// ₹650, 20.0 km is ₹700, and anything strictly above 20 km is ₹35/km.
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

/**
 * Distance-band fare. Each band up to `upTo` km is a FLAT price for the trip;
 * the final open-ended band bills per km across the whole distance.
 * `flat` = fixed price for the band; `perKm` = rate applied to the whole distance.
 */
const SLABS: { upTo: number; flat?: number; perKm?: number }[] = [
  { upTo: 13,       flat: 550 },
  { upTo: 15,       flat: 600 },
  { upTo: 18,       flat: 650 },
  { upTo: 20,       flat: 700 },
  { upTo: Infinity, perKm: 35 },
];

export const VEHICLE_SURCHARGE: Record<VehicleType, number> = {
  hatchback: 0,
  sedan: 0,
  suv: 5,
};

export const AC_SURCHARGE = 100;

/** Manual fare top-up options the supervisor can pick at booking time (₹). */
export const FARE_ADJUSTMENT_OPTIONS = [50, 75, 100, 125, 150] as const;

/** Minimum fare floor — no ride is priced below this regardless of distance */
export const MINIMUM_FARE = 550;

/** Escort charge rate — 50% of driver fare, added when escort is mandatory */
export const ESCORT_CHARGE_RATE = 0.5;

/**
 * Escort surcharge = 50% of the driver fare.
 */
export function escortCharge(driverFare: number): number {
  return Math.round(driverFare * ESCORT_CHARGE_RATE * 100) / 100;
}

// Driver fine policy removed: releasing/dropping/no-showing a ride no longer
// incurs any penalty. Broadcast eligibility is now gated by ride credits
// instead (see creditPack.service.ts).

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
  return Math.round(fare * 100) / 100;
}

// Group-size rule: 1–3 pax → any vehicle; 4+ → SUV only.
export function allowedVehicleTypes(pax: number): VehicleType[] {
  return pax <= 3 ? ['hatchback', 'sedan', 'suv'] : ['suv'];
}
