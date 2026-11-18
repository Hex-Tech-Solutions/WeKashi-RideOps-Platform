/**
 * Driver profile completeness (#9).
 *
 * Documents can only be uploaded once the driver has filled in:
 *   - Licence details: DL number + DL expiry
 *   - Personal: Aadhaar number (held as a hash + masked copy)
 *   - Payout UPI ID (supervisors pay the driver directly by UPI)
 *   - Vehicle info: vehicle number, vehicle type, seats, fuel type
 * The document upload route checks this server-side; the app shows the same
 * list on the Documents tab. Alternate phone is optional.
 */
import { prisma } from './prisma';
import { AppError } from '../types';

export const FUEL_TYPES = ['petrol', 'diesel', 'cng', 'electric'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export type ProfileItem =
  | 'dlNumber' | 'dlExpiry' | 'aadhaar' | 'upiId'
  | 'vehicleNo' | 'vehicleType' | 'seats' | 'fuelType';

export const PROFILE_ITEM_LABELS: Record<ProfileItem, string> = {
  dlNumber: 'Driving licence number',
  dlExpiry: 'Driving licence expiry date',
  aadhaar: 'Aadhaar number',
  upiId: 'UPI ID',
  vehicleNo: 'Vehicle number',
  vehicleType: 'Vehicle type',
  seats: 'Seats',
  fuelType: 'Fuel type',
};

export interface ProfileFields {
  dlNumber: string | null;
  dlExpiry: Date | null;
  govIdNumber: string | null;
  govIdHash: string | null;
  upiVpa: string | null;
  vehicleType: string | null;
  seats: number | null;
  vehicle: { regNo: string; capacity: number | null; fuelType: string | null } | null;
}

/** Items still to fill in, in display order. Empty = complete. */
export function profileMissing(d: ProfileFields): ProfileItem[] {
  const missing: ProfileItem[] = [];
  if (!d.dlNumber?.trim()) missing.push('dlNumber');
  if (!d.dlExpiry) missing.push('dlExpiry');
  // New entries carry a hash; older test rows may hold the 12 digits.
  const legacyAadhaar = (d.govIdNumber ?? '').replace(/\D/g, '').length === 12;
  if (!d.govIdHash && !legacyAadhaar) missing.push('aadhaar');
  if (!d.upiVpa?.trim()) missing.push('upiId');
  const reg = d.vehicle?.regNo ?? '';
  if (!reg || /^(removed|rejected):/.test(reg)) missing.push('vehicleNo');
  if (!d.vehicleType) missing.push('vehicleType');
  if (!(d.seats ?? d.vehicle?.capacity)) missing.push('seats');
  if (!d.vehicle?.fuelType) missing.push('fuelType');
  return missing;
}

export const PROFILE_SELECT = {
  dlNumber: true, dlExpiry: true, govIdNumber: true, govIdHash: true, upiVpa: true,
  vehicleType: true, seats: true,
  vehicle: { select: { regNo: true, capacity: true, fuelType: true } },
} as const;

/** 403 PROFILE_INCOMPLETE if the driver can't upload documents yet. */
export async function assertProfileComplete(driverId: string): Promise<void> {
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: PROFILE_SELECT });
  if (!d) throw new AppError(404, 'Driver not found', 'NOT_FOUND');
  const missing = profileMissing(d);
  if (missing.length === 0) return;
  throw new AppError(
    403,
    `Complete your profile before uploading documents. Missing: ${missing.map((m) => PROFILE_ITEM_LABELS[m]).join(', ')}.`,
    'PROFILE_INCOMPLETE',
  );
}
