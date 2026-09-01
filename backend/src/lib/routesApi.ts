/**
 * Google Routes API wrapper (https://routes.googleapis.com).
 *
 * Replaces the legacy Directions API (google.maps.DirectionsService) as the
 * SOURCE OF TRUTH for stop ordering, distance, and traffic-aware duration.
 *
 * Two methods used:
 *   - computeRoute()       — POST /directions/v2:computeRoutes
 *       Used to order the pickup/drop stops for a ride AND get the real
 *       driving distance + traffic-aware ETA in one call.
 *   - computeRouteMatrix() — POST /distanceMatrix/v2:computeRouteMatrix
 *       Used for many-origin/many-destination distance+ETA lookups, e.g.
 *       "how far is each online driver from this pickup point" or
 *       "driver's live distance from the next stop" (DriverApproachBadge).
 *
 * IMPORTANT — women's-safety interaction:
 *   This module does NOT know about gender or safety rules. It only orders
 *   waypoints for efficiency. The safety-critical position (first pickup for
 *   login, last drop for logout) must be pinned as the fixed `origin` or
 *   `destination` by the CALLER — never passed as an optimizable waypoint —
 *   so Google's optimizer can never move it. See ride.service.ts /
 *   routeOptimize.service.ts for how the pin is chosen.
 */

import { logger } from './logger';

const ROUTES_API_BASE = 'https://routes.googleapis.com';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface ComputeRouteWaypoint {
  location: LatLng;
}

export interface ComputeRouteOptions {
  origin: ComputeRouteWaypoint;
  destination: ComputeRouteWaypoint;
  /** Intermediate stops. Order is preserved unless optimizeWaypointOrder is true. */
  intermediates?: ComputeRouteWaypoint[];
  /** Let Google reorder `intermediates` for the most efficient route. origin/destination are NEVER reordered. */
  optimizeWaypointOrder?: boolean;
  /** ISO 8601 departure time for traffic prediction. Defaults to "now" server-side if omitted. */
  departureTime?: string;
}

export interface ComputeRouteResult {
  distanceMeters: number;
  /** Traffic-aware duration, in whole seconds. */
  durationSeconds: number;
  encodedPolyline: string | null;
  /** Present only when optimizeWaypointOrder was requested — maps each intermediate's
   *  ORIGINAL index (as sent in the request) to its position in the optimized order. */
  optimizedIntermediateWaypointIndex: number[] | null;
  /** Per-leg breakdown, one entry per origin→intermediate→...→destination hop, in FINAL (optimized) order. */
  legs: Array<{ distanceMeters: number; durationSeconds: number }>;
}

function apiKey(): string {
  const key = process.env.GOOGLE_ROUTES_API_KEY || process.env.VITE_GOOGLE_MAPS_KEY;
  if (!key) throw new Error('GOOGLE_ROUTES_API_KEY is not configured on the backend');
  return key;
}

function toWaypoint(w: ComputeRouteWaypoint) {
  return { location: { latLng: { latitude: w.location.lat, longitude: w.location.lng } } };
}

function parseDurationSeconds(duration: string | undefined): number {
  // Routes API returns duration as a string like "165s"
  if (!duration) return 0;
  const n = parseInt(duration.replace('s', ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute a single driving route through origin -> intermediates -> destination,
 * with traffic-aware duration. Optionally lets Google pick the most efficient
 * order for `intermediates` (origin/destination are always fixed).
 */
export async function computeRoute(opts: ComputeRouteOptions): Promise<ComputeRouteResult> {
  const body: Record<string, unknown> = {
    origin: toWaypoint(opts.origin),
    destination: toWaypoint(opts.destination),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    units: 'METRIC',
  };
  if (opts.intermediates?.length) {
    body.intermediates = opts.intermediates.map(toWaypoint);
  }
  if (opts.optimizeWaypointOrder) {
    body.optimizeWaypointOrder = true;
    // TRAFFIC_AWARE_OPTIMAL is incompatible with waypoint optimization per Google docs.
    body.routingPreference = 'TRAFFIC_AWARE';
  }
  if (opts.departureTime) {
    body.departureTime = opts.departureTime;
  }

  const fieldMask = [
    'routes.distanceMeters',
    'routes.duration',
    'routes.polyline.encodedPolyline',
    'routes.optimizedIntermediateWaypointIndex',
    'routes.legs.distanceMeters',
    'routes.legs.duration',
  ].join(',');

  const res = await fetch(`${ROUTES_API_BASE}/directions/v2:computeRoutes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    logger.error({ status: res.status, errBody }, 'Routes API computeRoutes failed');
    throw new Error(`Routes API error (${res.status}): ${errBody || res.statusText}`);
  }

  const data = await res.json() as any;
  const route = data.routes?.[0];
  if (!route) throw new Error('Routes API returned no route');

  return {
    distanceMeters: route.distanceMeters ?? 0,
    durationSeconds: parseDurationSeconds(route.duration),
    encodedPolyline: route.polyline?.encodedPolyline ?? null,
    optimizedIntermediateWaypointIndex: route.optimizedIntermediateWaypointIndex ?? null,
    legs: (route.legs ?? []).map((leg: any) => ({
      distanceMeters: leg.distanceMeters ?? 0,
      durationSeconds: parseDurationSeconds(leg.duration),
    })),
  };
}

export interface RouteMatrixElement {
  originIndex: number;
  destinationIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  /** false if Google could not find a route for this origin/destination pair. */
  routeExists: boolean;
}

/**
 * Compute distance + traffic-aware duration for every (origin, destination) pair.
 * Use this for "N drivers vs 1 pickup point" or "1 driver vs N remaining stops"
 * style lookups — one HTTP call instead of N sequential computeRoute() calls.
 *
 * Element cap: origins.length * destinations.length must stay <= 625 (100 if
 * using TRAFFIC_AWARE_OPTIMAL — we use plain TRAFFIC_AWARE so 625 applies).
 */
export async function computeRouteMatrix(
  origins: LatLng[],
  destinations: LatLng[],
): Promise<RouteMatrixElement[]> {
  if (origins.length === 0 || destinations.length === 0) return [];
  if (origins.length * destinations.length > 625) {
    throw new Error(`Route matrix too large: ${origins.length} origins x ${destinations.length} destinations > 625 elements`);
  }

  const body = {
    origins: origins.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
    destinations: destinations.map((d) => ({ waypoint: { location: { latLng: { latitude: d.lat, longitude: d.lng } } } })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };

  const fieldMask = 'originIndex,destinationIndex,duration,distanceMeters,status,condition';

  const res = await fetch(`${ROUTES_API_BASE}/distanceMatrix/v2:computeRouteMatrix`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    logger.error({ status: res.status, errBody }, 'Routes API computeRouteMatrix failed');
    throw new Error(`Routes API error (${res.status}): ${errBody || res.statusText}`);
  }

  const rows = await res.json() as any[];
  return rows.map((r) => ({
    originIndex: r.originIndex ?? 0,
    destinationIndex: r.destinationIndex ?? 0,
    distanceMeters: r.condition === 'ROUTE_EXISTS' ? (r.distanceMeters ?? 0) : null,
    durationSeconds: r.condition === 'ROUTE_EXISTS' ? parseDurationSeconds(r.duration) : null,
    routeExists: r.condition === 'ROUTE_EXISTS',
  }));
}
