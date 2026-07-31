/**
 * Women's Safety Escort Policy
 *
 * Simple rule: escort required when ALL of these are true:
 *   1. Ride time is in restricted window: 19:00–07:00
 *   2. At least one female passenger is present
 *   3. The final route has a female in a dangerous position:
 *        LOGIN  → first stop is female (alone with driver before anyone boards)
 *        LOGOUT → last stop is female (alone with driver after everyone exits)
 *
 * orderedGenders: the submitted employeeIds order mapped to genders.
 * Falls back to all-passenger list when not provided.
 *
 * Outside 07:00–19:00 → never an escort.
 * rideTime = null      → window unknown, skip window check.
 */

export const ESCORT_WINDOW_START_HOUR = 7;
export const ESCORT_WINDOW_END_HOUR   = 19;

export interface EscortPassenger {
  gender: string;
}

export interface EscortPolicyInput {
  passengers:     EscortPassenger[];
  rideTime:       Date | null;
  rideType:       string;
  orderedGenders?: string[]; // genders in final route order
}

export interface EscortPolicyResult {
  required: boolean;
  reason?:  string;
}

function isFemale(g: string): boolean {
  const s = (g ?? '').trim().toLowerCase();
  return s === 'f' || s === 'female';
}

function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(input: EscortPolicyInput): EscortPolicyResult {
  const { passengers, rideTime, rideType, orderedGenders } = input;
  if (!passengers.length) return { required: false };

  const hasFemale = passengers.some((p) => isFemale(p.gender));
  if (!hasFemale) return { required: false };

  if (!inRestrictedWindow(rideTime)) return { required: false };

  // ── In restricted window ──────────────────────────────────────────────────
  const ordered = orderedGenders?.length
    ? orderedGenders
    : passengers.map((p) => p.gender);

  const isLogin = rideType !== 'logout';
  const first   = ordered[0];
  const last    = ordered[ordered.length - 1];

  if (isLogin && isFemale(first)) {
    return {
      required: true,
      reason: 'First pickup is female — she will be alone with the driver during restricted hours (19:00–07:00)',
    };
  }

  if (isFemale(last)) {
    return {
      required: true,
      reason: 'Last stop is female — she will be alone with the driver during restricted hours (19:00–07:00)',
    };
  }

  return { required: false };
}
