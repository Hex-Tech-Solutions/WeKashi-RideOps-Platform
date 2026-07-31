/**
 * Women's Safety Escort Policy — MoveInSync-style rules.
 *
 * STEP 1 — Auto-reorder (called before this function, in route optimisation):
 *   The route is reordered so a female is never:
 *     - seq 0  (first pickup — alone with driver before anyone boards)
 *     - last   (last pickup/drop — alone with driver after everyone exits)
 *   If reordering solves the isolation, no escort is needed.
 *
 * STEP 2 — Escort required (cannot be solved by reordering):
 *   Case A: Only ONE female in the ride → she will always be alone with the
 *           driver at SOME point regardless of order.
 *   Case B: ALL passengers are female → no male buffer exists.
 *   Case C: Restricted time window (before 07:00 or after 19:00) AND at least
 *           one female exists AND reordering cannot guarantee she is never
 *           adjacent-only-with-driver (e.g. lone female after all males drop).
 *
 * The function returns:
 *   { required: false }                        — no escort needed
 *   { required: true, reason: string }         — escort mandatory
 *
 * Both backend (Node) and frontend (browser) import this file — keep it
 * dependency-free (no prisma, no express).
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: 'M' | 'F' | string; // 'F'/'f'/'Female' all treated as female
}

export interface EscortPolicyInput {
  passengers: EscortPassenger[];
  /** Scheduled ride time — used for time-window check. null = now. */
  rideTime: Date | null;
  /** 'login' | 'logout' | 'scheduled' */
  rideType: string;
}

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
  /** True when the route was (or should be) reordered and escort is NOT required. */
  reordered?: boolean;
}

function isFemale(gender: string): boolean {
  const g = gender.trim().toLowerCase();
  return g === 'f' || g === 'female';
}

function inRestrictedWindow(rideTime: Date | null): boolean {
  const t = rideTime ?? new Date();
  const h = t.getHours() + t.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(input: EscortPolicyInput): EscortPolicyResult {
  const { passengers, rideTime, rideType } = input;
  if (!passengers.length) return { required: false };

  const females = passengers.filter((p) => isFemale(p.gender));
  const males   = passengers.filter((p) => !isFemale(p.gender));

  const femaleCount = females.length;
  const maleCount   = males.length;
  const total       = passengers.length;

  // No females at all → no escort
  if (femaleCount === 0) return { required: false };

  const isLogout = rideType === 'logout';

  // ── LOGOUT: everyone boards together at the office ─────────────────────────
  // There is no "first pickup alone" problem. The only danger is at drop-offs.
  if (isLogout) {
    // Case B: all female → no male buffer at any point
    if (maleCount === 0) {
      return { required: true, reason: 'All passengers are female — no male buffer available' };
    }
    // Case A: lone female → she will be the last one dropped, alone with driver
    if (femaleCount === 1) {
      return {
        required: true,
        reason: 'Only one female in the ride — she will be alone with the driver at the last drop-off',
      };
    }
    // Last drop is female AND restricted window → reorder can fix first/middle but
    // if femaleCount > maleCount a female must be at the last drop.
    if (inRestrictedWindow(rideTime) && femaleCount > maleCount) {
      return {
        required: true,
        reason: `Night window — ${femaleCount} female(s) but only ${maleCount} male(s); a female will be at the last drop-off`,
      };
    }
    // Otherwise reorder handles it (put a male last)
    return { required: false, reordered: femaleCount > 0 && maleCount > 0 };
  }

  // ── LOGIN: pickups are individual — both first and last stop are exposed ────

  // Case A: lone female (any time)
  if (femaleCount === 1 && total === 1) {
    return { required: true, reason: 'Single female passenger travelling alone with driver' };
  }

  if (femaleCount === 1 && maleCount >= 1) {
    return {
      required: true,
      reason: 'Only one female in the ride — she will be alone with the driver during first pickup and last drop',
    };
  }

  // Case B: all female
  if (maleCount === 0) {
    return { required: true, reason: 'All passengers are female — no male buffer available' };
  }

  // Case C: restricted time window
  if (inRestrictedWindow(rideTime)) {
    const canReorderSolveIt = femaleCount <= maleCount;
    if (!canReorderSolveIt) {
      return {
        required: true,
        reason: `Night/early window (before 07:00 or after 19:00) — ${femaleCount} female(s) but only ${maleCount} male(s); cannot avoid lone female at route ends`,
      };
    }
    return { required: false, reordered: true };
  }

  // Day-time, multiple genders, reorder handles it
  return { required: false, reordered: femaleCount > 0 && maleCount > 0 };
}
