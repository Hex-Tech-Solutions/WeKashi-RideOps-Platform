/**
 * Women's Safety Escort Policy — MoveInSync-style rules.
 *
 * LOGIN rides (individual pickups from homes):
 *   Only seq=0 (first pickup) is an isolation risk.
 *   After seq=0 boards, every subsequent pickup enters an already-occupied cab.
 *   Escort required when: no male exists to occupy seq=0.
 *   Night window: safe as long as a male is seq=0 — same rule applies.
 *
 * LOGOUT rides (all board at office, drop at individual homes):
 *   No "first pickup alone" problem — everyone boards together.
 *   Only the last drop is an isolation risk.
 *   Route optimizer puts females first → a male is always the last drop.
 *   Escort required when: all-female, lone female, or (night window + females > males).
 *
 * Time window: before 07:00 or after 19:00.
 * rideTime = null → window rules are skipped (supervisor hasn't set a time yet).
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
  // If no ride time has been set, skip the window check — don't assume current time.
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(input: EscortPolicyInput): EscortPolicyResult {
  const { passengers, rideTime, rideType } = input;
  if (!passengers.length) return { required: false };

  const females = passengers.filter((p) => isFemale(p.gender));
  const males   = passengers.filter((p) => !isFemale(p.gender));

  const femaleCount = females.length;
  const maleCount   = males.length;

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

  // ── LOGIN: individual pickups — only seq=0 is an isolation risk ────────────
  // After seq=0 boards, every subsequent pickup happens into an occupied cab.
  // Escort needed only when no male exists to occupy seq=0.

  // Case A: lone female (total = 1)
  if (femaleCount === 1 && maleCount === 0) {
    return { required: true, reason: 'Single female passenger travelling alone with driver' };
  }

  // Case B: all female — no male can take seq=0
  if (maleCount === 0) {
    return { required: true, reason: 'All passengers are female — no male buffer available' };
  }

  // At least 1 male → he takes seq=0, all females board into an occupied cab → safe
  return { required: false, reordered: femaleCount > 0 && maleCount > 0 };
}
