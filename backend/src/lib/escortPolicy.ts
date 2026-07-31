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

  // ── Case A: lone female (any time) ─────────────────────────────────────────
  // With only one female, she will be alone with the driver at first pickup
  // (before anyone else boards) or after all others exit. Reordering cannot fix this.
  if (femaleCount === 1 && total === 1) {
    return { required: true, reason: 'Single female passenger travelling alone with driver' };
  }

  if (femaleCount === 1 && maleCount >= 1) {
    // She will be alone with driver at first pickup (before seq-1 boards)
    // AND potentially at the last drop (after seq-last-male exits).
    // Even with perfect reordering she is briefly alone at both ends.
    return {
      required: true,
      reason: 'Only one female in the ride — she will be alone with the driver during first pickup and last drop',
    };
  }

  // ── Case B: all female ─────────────────────────────────────────────────────
  if (maleCount === 0) {
    return { required: true, reason: 'All passengers are female — no male buffer available' };
  }

  // ── Case C: restricted time window ─────────────────────────────────────────
  if (inRestrictedWindow(rideTime)) {
    // Check if reordering can guarantee no female is ever alone with the driver.
    // Reordering CAN fix it when:
    //   - There are ≥ 2 females spread through the route with males between them.
    // Reordering CANNOT fully fix it when:
    //   - There are females at BOTH ends of the route (first pickup AND last drop)
    //     and no males to occupy those positions.
    //   - i.e. femaleCount > maleCount (more females than males means a female
    //     must occupy an "exposed" end position).
    const canReorderSolveIt = femaleCount <= maleCount;

    if (!canReorderSolveIt) {
      return {
        required: true,
        reason: `Night/early window (before 07:00 or after 19:00) — ${femaleCount} female(s) but only ${maleCount} male(s); cannot avoid lone female at route ends`,
      };
    }

    // Reorder solves it — note this for the UI ("Route reordered for safety")
    return { required: false, reordered: true };
  }

  // ── Day-time, multiple genders, reorder handles it ────────────────────────
  return { required: false, reordered: femaleCount > 0 && maleCount > 0 };
}
