/**
 * Women's Safety Escort Policy — frontend mirror of backend/src/lib/escortPolicy.ts
 *
 * Keep in sync with the backend version. This runs in the browser to give the
 * supervisor real-time feedback during booking (Steps 1-3 of Routes.tsx).
 *
 * Single source of truth for escort decisions — geo.ts only handles ordering.
 *
 * LOGIN rides (individual pickups from homes):
 *   Only seq=0 (first pickup) is an isolation risk — the driver arrives alone.
 *   After seq=0 boards, every subsequent pickup enters an already-occupied cab.
 *   Escort required when: no male exists to occupy seq=0 (all-female or lone female).
 *   Night window: same rule — as long as a male is seq=0, the ride is safe.
 *
 * LOGOUT rides (all board at the office together, drop at individual homes):
 *   No "first pickup alone" problem — everyone boards together.
 *   Only the last drop is an isolation risk — one passenger left alone with driver.
 *   Strategy: drop females first → a male is always last.
 *   Escort required when: all-female, lone female, or (night window + females > males).
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: 'M' | 'F' | string;
}

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
  /** True when the route was reordered but escort is not needed — show info note. */
  reordered: boolean;
}

function isFemale(gender: string): boolean {
  const g = (gender ?? '').trim().toLowerCase();
  return g === 'f' || g === 'female';
}

export function inRestrictedWindow(rideTime: Date | null): boolean {
  // If no ride time has been set by the supervisor, we cannot determine the
  // window — do NOT assume the current time. Return false so the window rule
  // is skipped until the supervisor actually picks a time.
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(
  passengers: EscortPassenger[],
  rideTime: Date | null,
  rideType: string = 'login',
): EscortPolicyResult {
  if (!passengers.length) return { required: false, reordered: false };

  const femaleCount = passengers.filter((p) => isFemale(p.gender)).length;
  const maleCount   = passengers.length - femaleCount;

  if (femaleCount === 0) return { required: false, reordered: false };

  const isLogout = rideType === 'logout';

  // ── LOGOUT: everyone boards at the office together ─────────────────────────
  // No "first pickup alone" problem. Risk is only at individual drop-offs.
  if (isLogout) {
    // Case B: all female
    if (maleCount === 0) {
      return { required: true, reordered: false, reason: 'All passengers are female — no male buffer available' };
    }
    // Case A: lone female → will be last drop, alone with driver
    if (femaleCount === 1) {
      return {
        required: true,
        reordered: false,
        reason: 'Only one female in the ride — she will be alone with the driver at the last drop-off',
      };
    }
    // Night window + more females than males → a female must be at last drop
    if (inRestrictedWindow(rideTime) && femaleCount > maleCount) {
      return {
        required: true,
        reordered: false,
        reason: `Night window — ${femaleCount} female(s) but only ${maleCount} male(s); a female will be at the last drop-off`,
      };
    }
    return { required: false, reordered: femaleCount > 0 && maleCount > 0 };
  }

  // ── LOGIN: individual pickups — only seq=0 is an isolation risk ────────────
  // After seq=0 boards, every subsequent passenger boards into an occupied cab.
  // Escort needed only when no male exists to occupy seq=0.

  // Case A: lone female (total = 1) — she IS seq=0, alone with driver the entire ride
  if (femaleCount === 1 && maleCount === 0) {
    return { required: true, reordered: false, reason: 'Single female passenger travelling alone with driver' };
  }

  // Case B: all female — no male can take seq=0
  if (maleCount === 0) {
    return { required: true, reordered: false, reason: 'All passengers are female — no male buffer available' };
  }

  // At least 1 male exists → reorder puts him at seq=0 → all females board into
  // an occupied cab → safe regardless of time window
  return { required: false, reordered: femaleCount > 0 };
}
