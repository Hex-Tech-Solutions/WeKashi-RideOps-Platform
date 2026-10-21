// Strip fields a DRIVER must never receive from a ride payload.
//
// getRide / listRides / listScheduledRidesForDriver use Prisma `include` with
// no field selection, so they return the ENTIRE ride row — including the
// supervisor-relayed OTPs (escortOtp, airportPickupOtp, airportDropOtp), the
// payment reference, and the full offer list (every offered driver's phone).
// A driver who holds a ride could read the OTPs straight off GET /rides/:id and
// self-complete a trip with no passenger, defeating the OTP gate entirely.
//
// This removes those fields for driver-facing responses. Supervisors/admins
// still get them (they legitimately relay the OTPs). Keep this in sync if new
// secret columns are added to the Ride model.

const DRIVER_FORBIDDEN_KEYS = [
  'escortOtp',
  'airportPickupOtp',
  'airportDropOtp',
  'paymentRef',
  'rideOffers', // contains other drivers' names + phones
] as const;

/** Return a shallow copy of a ride object with driver-forbidden fields removed. */
export function stripRideSecretsForDriver<T extends Record<string, unknown>>(ride: T): T {
  if (!ride || typeof ride !== 'object') return ride;
  const clone: Record<string, unknown> = { ...ride };
  for (const k of DRIVER_FORBIDDEN_KEYS) delete clone[k];
  return clone as T;
}

export function stripRideListForDriver<T extends Record<string, unknown>>(rides: T[]): T[] {
  return rides.map((r) => stripRideSecretsForDriver(r));
}
