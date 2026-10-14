/**
 * Extract the Area / Locality from a full address so the driver can see, at a
 * glance, which side of town a ride's pickup and drop are on.
 *
 * Indian geocoded addresses look like:
 *   "10, Mahatma Gandhi Rd, Halasuru, Yellappa Garden, Sivanchetti Gardens,
 *    Bengaluru, Karnataka 560001, India"
 *   "Rajajinagar, Bengaluru, Karnataka, India"
 *
 * We take the first segment that is a real locality — skipping pure
 * house/plot numbers — and prefer a road/locality-type token when present.
 */
const PIN = /^\d{6}$/;
const HOUSE_NO = /^(no\.?\s*)?\d+[a-z]?$/i;
const CITY_STATE_NOISE = /^(bengaluru|bangalore|karnataka|india)$/i;
const LOCALITY_HINT = /\b(rd|road|marg|main|cross|nagar|layout|garden|gardens|circle|town|colony|extension|hobli)\b/i;

export function rideArea(address: string | null | undefined): string | null {
  if (!address) return null;
  const segments = address.split(",").map((s) => s.trim()).filter(Boolean);
  const meaningful = segments.filter(
    (s) => !PIN.test(s) && !HOUSE_NO.test(s) && !CITY_STATE_NOISE.test(s),
  );
  if (meaningful.length === 0) return null;
  const hinted = meaningful.find((s) => LOCALITY_HINT.test(s));
  return hinted ?? meaningful[0];
}
