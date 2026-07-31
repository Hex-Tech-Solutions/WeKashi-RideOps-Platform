// Deterministic mock geo for the RideOps demo.
// Pickup names map to fixed lat/lng AND fixed (x,y) coords on a 800x400 SVG viewBox.

export interface GeoPoint {
  lat: number;
  lng: number;
  x: number; // 0-800
  y: number; // 0-400
}

// Hand-placed Bangalore-ish coords. The (x,y) are spread across the viewBox so the
// rendered map looks balanced regardless of which subset of stops is chosen.
export const PLACES: Record<string, GeoPoint> = {
  "Jayanagar 4th Block":   { lat: 12.9250, lng: 77.5830, x: 120, y: 300 },
  "JP Nagar 7th Phase":    { lat: 12.9080, lng: 77.5850, x: 180, y: 340 },
  "BTM 2nd Stage":         { lat: 12.9165, lng: 77.6101, x: 280, y: 290 },
  "Bannerghatta Road":     { lat: 12.8870, lng: 77.5970, x: 220, y: 370 },
  "HSR Layout Sector 2":   { lat: 12.9116, lng: 77.6370, x: 380, y: 280 },
  "Koramangala 5th Block": { lat: 12.9352, lng: 77.6245, x: 340, y: 230 },
  "Indiranagar":           { lat: 12.9716, lng: 77.6412, x: 420, y: 150 },
  "Marathahalli":          { lat: 12.9590, lng: 77.6970, x: 560, y: 180 },
  "Whitefield":            { lat: 12.9698, lng: 77.7500, x: 680, y: 140 },
  "Electronic City":       { lat: 12.8456, lng: 77.6603, x: 460, y: 380 },
  "South Bangalore":       { lat: 12.9000, lng: 77.5700, x: 100, y: 360 },
  "JP Nagar":              { lat: 12.9080, lng: 77.5850, x: 180, y: 340 },
  // Drop point
  "Embassy Tech Village":  { lat: 12.9849, lng: 77.7350, x: 720, y: 100 },
};

export const DROP = "Embassy Tech Village";

export function getPoint(name: string): GeoPoint {
  return PLACES[name] ?? { lat: 12.95, lng: 77.6, x: 400, y: 200 };
}

// Haversine in km
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface RouteStop {
  empId: string;
  name: string;
  gender: "M" | "F";
  location: string;
  point: GeoPoint;
}

export interface RouteResult {
  stops: RouteStop[];
  drop: { name: string; point: GeoPoint };
  totalKm: number;
  etaMin: number;
  safetyOk: boolean;
  safetyIssue?: string;
}

function nearestNeighborOrder(start: GeoPoint, stops: RouteStop[]): RouteStop[] {
  const remaining = [...stops];
  const ordered: RouteStop[] = [];
  let current = start;
  while (remaining.length) {
    remaining.sort((a, b) => distanceKm(current, a.point) - distanceKm(current, b.point));
    const next = remaining.shift()!;
    ordered.push(next);
    current = next.point;
  }
  return ordered;
}

// Validates the final ordered stop list for obvious safety violations after reorder.
// This is used ONLY to flag display issues in the UI — escort decisions come from escortPolicy.ts.
//
// Login:  only seq=0 is dangerous (first pickup — alone with driver before anyone boards).
//         Last pickup is SAFE — earlier passengers are already on board.
// Logout: only last position is dangerous (last drop — alone with driver after everyone exits).
//         First position is SAFE — everyone boards at the office together.
export function checkSafety(stops: RouteStop[], type: "login" | "logout" = "login"): { ok: boolean; issue?: string } {
  if (!stops.length) return { ok: true };

  const hasMale   = stops.some((s) => s.gender === "M");
  const hasFemale = stops.some((s) => s.gender === "F");

  // All-male or all-female — escortPolicy handles this; no reorder issue
  if (!hasMale || !hasFemale) return { ok: true };

  if (type === "login") {
    // Only seq=0 is an isolation risk for login
    if (stops[0].gender === "F") {
      return { ok: false, issue: `${stops[0].name} is first pickup — she will be alone with the driver before others board` };
    }
  } else {
    // Only last position is an isolation risk for logout
    const last = stops[stops.length - 1];
    if (last.gender === "F") {
      return { ok: false, issue: `${last.name} is last drop — she will be alone with the driver after others exit` };
    }
  }

  return { ok: true };
}

interface EmployeeLike { id: string; name: string; gender: "M" | "F"; pickup: string }
export function optimizeRoute(employees: EmployeeLike[], dropName = DROP, type: "login" | "logout" = "login"): RouteResult {
  const stops: RouteStop[] = employees.map((e) => ({
    empId: e.id,
    name: e.name,
    gender: e.gender,
    location: e.pickup,
    point: getPoint(e.pickup),
  }));
  return optimizeStops(stops, { name: dropName, point: getPoint(dropName) }, type);
}

// Order a set of pre-built stops (with real coordinates) and apply female-safety.
export function optimizeStops(
  stops: RouteStop[],
  drop: { name: string; point: GeoPoint },
  type: "login" | "logout" = "login",
): RouteResult {
  // ── Step 1: nearest-neighbour ordering ───────────────────────────────────
  // Login: collect from homes toward the office → reverse so we start at the
  // furthest-from-office stop and end nearest.
  // Logout: start from office and drop at homes in nearest-first order.
  let ordered = nearestNeighborOrder(drop.point, stops);
  if (type === "login") ordered = ordered.reverse();

  const hasMale   = ordered.some((s) => s.gender === "M");
  const hasFemale = ordered.some((s) => s.gender === "F");

  // ── Step 2: female-safety reordering ─────────────────────────────────────
  // Only possible when there is at least one male to act as buffer.
  if (hasMale && hasFemale) {
    if (type === "logout") {
      // LOGOUT: all board at the office together.
      // Drop females FIRST so a male is always the last to exit.
      const females = ordered.filter((s) => s.gender === "F");
      const males   = ordered.filter((s) => s.gender === "M");
      ordered = [...females, ...males];
    } else {
      // LOGIN: only seq=0 is an isolation risk.
      // After seq=0 boards, every subsequent pickup has at least one other
      // passenger already in the cab — the last pickup is NOT alone with the driver.
      if (ordered[0].gender === "F") {
        const firstMaleIdx = ordered.findIndex((s) => s.gender === "M");
        if (firstMaleIdx > 0) {
          [ordered[0], ordered[firstMaleIdx]] = [ordered[firstMaleIdx], ordered[0]];
        }
      }
    }
  }

  return buildResult(ordered, drop, type);
}

// Build a GeoPoint from raw coordinates (x/y only used for the demo SVG, so approximate).
export function coordPoint(lat: number, lng: number): GeoPoint {
  return { lat, lng, x: 400, y: 200 };
}

export function buildResult(ordered: RouteStop[], drop: { name: string; point: GeoPoint }, type: "login" | "logout" = "login"): RouteResult {
  let totalKm = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    totalKm += distanceKm(ordered[i].point, ordered[i + 1].point);
  }
  if (ordered.length) totalKm += distanceKm(ordered[ordered.length - 1].point, drop.point);
  const etaMin = Math.round(totalKm * 3 + ordered.length * 2.5);
  const safety = checkSafety(ordered, type);
  return {
    stops: ordered,
    drop,
    totalKm: Math.round(totalKm * 10) / 10,
    etaMin,
    safetyOk: safety.ok,
    safetyIssue: safety.issue,
  };
}

// Note: suggestPrice and listPickupOptions removed — use computeFare() from pricing.ts instead.
