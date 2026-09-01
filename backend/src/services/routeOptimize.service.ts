/**
 * Route ordering for ride booking — powered by Google Routes API.
 *
 * Replaces the old Haversine nearest-neighbour + gender-swap logic that used
 * to live in the frontend (src/lib/geo.ts). Two Routes API calls:
 *
 *   1. computeRouteMatrix — real driving distance/duration between EVERY pair
 *      of stops (office + all employee homes). Used to run nearest-neighbour
 *      ordering with actual road data instead of straight-line guesses.
 *   2. computeRoute — ONE call on the final fixed sequence, to get the real
 *      polyline + traffic-aware total duration for display.
 *
 * IMPORTANT — no gender/safety logic here. This module ONLY orders stops for
 * efficiency. The escort/women's-safety check (escortPolicy.ts) runs
 * separately, AFTER this order (or the supervisor's manual edit of it) is
 * finalized, and is the sole safety enforcement mechanism — see
 * routes.ts POST /rides for where that check happens.
 */

import { computeRoute, computeRouteMatrix, type LatLng } from '../lib/routesApi';
import { logger } from '../lib/logger';

export interface OptimizeStopInput {
  empId: string;
  lat: number;
  lng: number;
}

export interface OptimizedStop extends OptimizeStopInput {
  seq: number;
}

export interface OptimizeRouteResult {
  stops: OptimizedStop[];
  totalDistanceKm: number;
  /** Traffic-aware total duration, in minutes. */
  etaMin: number;
  encodedPolyline: string | null;
}

/**
 * Nearest-neighbour ordering using a real distance/duration matrix (not
 * Haversine). `office` is the fixed anchor (login ends there, logout starts
 * there); every stop in `stops` is free to be ordered however is shortest —
 * no position is reserved for any particular stop.
 */
function nearestNeighborFromMatrix(
  officeIdx: number,
  stopIndices: number[],
  matrix: Map<string, number>, // key `${from}:${to}` -> durationSeconds
): number[] {
  const remaining = new Set(stopIndices);
  const ordered: number[] = [];
  let current = officeIdx;
  while (remaining.size) {
    let best: number | null = null;
    let bestCost = Infinity;
    for (const idx of remaining) {
      const cost = matrix.get(`${current}:${idx}`) ?? Infinity;
      if (cost < bestCost) { bestCost = cost; best = idx; }
    }
    // Fallback: if matrix lookup somehow missed (shouldn't happen), just take any remaining
    const next = best ?? remaining.values().next().value!;
    ordered.push(next);
    remaining.delete(next);
    current = next;
  }
  return ordered;
}

/**
 * Order the given stops for a login/logout ride and return real
 * distance/duration/polyline for the final sequence.
 *
 * Login:  driver visits every employee home, ends at the office.
 *         (There's no real "driver start point" yet at booking time — no
 *         driver is assigned. We order purely by which sequence of home
 *         pickups is shortest overall, ending at the office.)
 * Logout: driver starts at the office, visits every employee home.
 */
export async function optimizeRouteOrder(
  stops: OptimizeStopInput[],
  office: LatLng,
  type: 'login' | 'logout',
  /** When false, keep `stops` in the exact order given — just compute real
   *  distance/duration/polyline for that fixed sequence. Used after the
   *  supervisor manually drags/reorders a stop, or moves a pin, so we don't
   *  silently re-optimize an order they just deliberately changed. */
  optimize = true,
): Promise<OptimizeRouteResult> {
  if (stops.length === 0) {
    return { stops: [], totalDistanceKm: 0, etaMin: 0, encodedPolyline: null };
  }

  if (!optimize) {
    return computeFixedOrderRoute(stops, office, type);
  }

  // Single stop — no ordering decision to make, just get real distance/ETA.
  if (stops.length === 1) {
    return computeFixedOrderRoute(stops, office, type);
  }

  // ── Step 1: real pairwise distance/duration matrix (office + all stops) ──
  const nodes: LatLng[] = [office, ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const officeIdx = 0;
  const stopIndices = stops.map((_, i) => i + 1);

  let matrix: Map<string, number>;
  try {
    const elements = await computeRouteMatrix(nodes, nodes);
    matrix = new Map();
    for (const el of elements) {
      if (el.originIndex === el.destinationIndex) continue;
      matrix.set(`${el.originIndex}:${el.destinationIndex}`, el.routeExists ? (el.durationSeconds ?? Infinity) : Infinity);
    }
  } catch (err) {
    logger.error({ err }, 'computeRouteMatrix failed — falling back to submitted order');
    // Fail-safe: keep the order the caller submitted rather than blocking booking entirely.
    const fallbackOrdered = stops.map((s, i) => ({ ...s, seq: i }));
    return { stops: fallbackOrdered, totalDistanceKm: 0, etaMin: 0, encodedPolyline: null };
  }

  // ── Step 2: nearest-neighbour ordering using real durations ──────────────
  // Logout: office -> nearest -> nearest -> ... (natural order, driver starts at office).
  // Login:  compute the same way (nearest-neighbour FROM office through all
  //         homes), then REVERSE — so the route starts at the home farthest
  //         from the office and ends nearest to it, arriving at the office last.
  let orderedIndices = nearestNeighborFromMatrix(officeIdx, stopIndices, matrix);
  if (type === 'login') orderedIndices = orderedIndices.reverse();

  const orderedStops: OptimizedStop[] = orderedIndices.map((idx, seq) => ({ ...stops[idx - 1], seq }));

  // ── Step 3: one computeRoute call on the FINAL fixed sequence ────────────
  // (no optimizeWaypointOrder — order is already decided; this call is just
  // to get the real polyline + traffic-aware total duration for display.)
  return computeFixedOrderRoute(orderedStops, office, type);
}

/**
 * Compute real distance/duration/polyline for stops in the EXACT order given
 * (no reordering). Used both as a fallback (single stop) and when the caller
 * explicitly wants the fixed order preserved (optimize=false).
 */
async function computeFixedOrderRoute(
  stops: OptimizeStopInput[],
  office: LatLng,
  type: 'login' | 'logout',
): Promise<OptimizeRouteResult> {
  const orderedStops: OptimizedStop[] = stops.map((s, seq) => ({ ...s, seq }));
  const orderedLatLngs = orderedStops.map((s) => ({ lat: s.lat, lng: s.lng }));
  const [origin, destination, intermediates] = type === 'logout'
    ? [office, orderedLatLngs[orderedLatLngs.length - 1], orderedLatLngs.slice(0, -1)]
    : [orderedLatLngs[0], office, orderedLatLngs.slice(1)];

  try {
    const route = await computeRoute({
      origin: { location: origin },
      destination: { location: destination },
      intermediates: intermediates.map((p) => ({ location: p })),
    });
    return {
      stops: orderedStops,
      totalDistanceKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
      etaMin: Math.round(route.durationSeconds / 60),
      encodedPolyline: route.encodedPolyline,
    };
  } catch (err) {
    logger.error({ err }, 'computeRoute (fixed order) failed — returning order without distance/polyline');
    return { stops: orderedStops, totalDistanceKm: 0, etaMin: 0, encodedPolyline: null };
  }
}
