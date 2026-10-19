// Rental pricing catalog — Sedan & SUV only. Base packages plus per-km / per-hr
// overage rates. Single source of truth shared by the API and (via an endpoint)
// the frontend so prices never drift.

export type RentalVehicleType = 'sedan' | 'suv';
// Alias kept for the rental service's import.
export type RentalVehicle = RentalVehicleType;

export interface RentalPack {
  key: string;            // e.g. 's_2_20'
  vehicleType: RentalVehicleType;
  hours: number;
  km: number;
  price: number;          // base package price (₹)
  popular?: boolean;
}

// Overage rates per vehicle type.
export const RENTAL_RATES: Record<RentalVehicleType, { extraPerKm: number; extraPerHr: number }> = {
  sedan: { extraPerKm: 15, extraPerHr: 130 },
  suv: { extraPerKm: 20, extraPerHr: 150 },
};

export const RENTAL_PACKS: RentalPack[] = [
  // Sedan
  { key: 's_2_20', vehicleType: 'sedan', hours: 2, km: 20, price: 600, popular: true },
  { key: 's_4_40', vehicleType: 'sedan', hours: 4, km: 40, price: 1200 },
  { key: 's_6_60', vehicleType: 'sedan', hours: 6, km: 60, price: 1800 },
  { key: 's_8_80', vehicleType: 'sedan', hours: 8, km: 80, price: 2200 },
  { key: 's_12_120', vehicleType: 'sedan', hours: 12, km: 120, price: 2600 },
  // SUV (4h / 8h / 12h only)
  { key: 'u_4_40', vehicleType: 'suv', hours: 4, km: 40, price: 2000 },
  { key: 'u_8_80', vehicleType: 'suv', hours: 8, km: 80, price: 2600 },
  { key: 'u_12_120', vehicleType: 'suv', hours: 12, km: 120, price: 3200 },
];

export interface RentalPackFull extends RentalPack {
  basePrice: number;
  extraPerKm: number;
  extraPerHr: number;
}

export function getRentalPack(key: string): RentalPackFull | undefined {
  const p = RENTAL_PACKS.find((x) => x.key === key);
  if (!p) return undefined;
  return { ...p, basePrice: p.price, ...RENTAL_RATES[p.vehicleType] };
}

export function listRentalPacks(
  vehicleType?: RentalVehicleType,
): Array<RentalPack & { basePrice: number; extraPerKm: number; extraPerHr: number }> {
  return RENTAL_PACKS
    .filter((p) => !vehicleType || p.vehicleType === vehicleType)
    // Expose `basePrice` (alias of `price`) so the frontend's RentalPack type
    // matches the JSON — the card reads pack.basePrice.
    .map((p) => ({ ...p, basePrice: p.price, ...RENTAL_RATES[p.vehicleType] }));
}

export interface RentalOverage {
  overHours: number;   // billable extra hours (prorated to the minute, 2 dp)
  overKm: number;      // billable extra km (whole km, rounded up)
  hoursAmount: number; // ₹ for the hours overage
  kmAmount: number;    // ₹ for the km overage
  overageAmount: number; // total ₹ overage
}

/**
 * Compute a rental's overage, given the package and the actuals.
 *
 * Rules (confirmed with product):
 *   • Hours are prorated by the minute:  extraPerHr × (overMinutes / 60).
 *   • KM are billed per whole km over:   extraPerKm × ceil(overKm).
 *   • Each dimension is billed independently — whichever limit is crossed
 *     first starts accruing on that dimension; the other accrues only once it
 *     too is exceeded.
 *
 * @param packKey    the rental's package key
 * @param elapsedMin minutes since pickup-OTP (the live timer)
 * @param distanceKm GPS-odometer distance since pickup, in km
 */
export function computeRentalOverage(
  packKey: string,
  elapsedMin: number,
  distanceKm: number,
): RentalOverage {
  const pack = getRentalPack(packKey);
  if (!pack) {
    return { overHours: 0, overKm: 0, hoursAmount: 0, kmAmount: 0, overageAmount: 0 };
  }

  const includedMin = pack.hours * 60;
  const overMin = Math.max(0, elapsedMin - includedMin);
  const overHours = Math.round((overMin / 60) * 100) / 100;       // prorated, 2dp
  const hoursAmount = Math.round(pack.extraPerHr * (overMin / 60));

  const rawOverKm = Math.max(0, distanceKm - pack.km);
  const overKm = Math.ceil(rawOverKm);                            // whole km over
  const kmAmount = pack.extraPerKm * overKm;

  const overageAmount = hoursAmount + kmAmount;
  return { overHours, overKm, hoursAmount, kmAmount, overageAmount };
}
