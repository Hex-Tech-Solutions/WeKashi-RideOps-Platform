/**
 * Extract the Area / Locality from a full address so the driver can see, at a
 * glance, which side of town a ride's pickup and drop are on.
 *
 * Indian geocoded addresses look like:
 *   "10, Mahatma Gandhi Rd, Halasuru, Yellappa Garden, Sivanchetti Gardens,
 *    Bengaluru, Karnataka 560001, India"
 *   "Rajajinagar, Bengaluru, Karnataka, India"
 *
 * City-agnostic: Google addresses end with "<City>, <State PIN>, <Country>", so
 * we strip state/PIN/country lines and the trailing city, then take the first
 * real locality (preferring a road/locality-type token).
 */
const PIN = /^\d{6}$/;
const HOUSE_NO = /^(no\.?\s*)?\d+[a-z]?$/i;
const STATE_PIN_COUNTRY = /\b\d{6}\b|karnataka|maharashtra|tamil nadu|telangana|kerala|andhra pradesh|delhi|india/i;
const LOCALITY_HINT = /\b(rd|road|marg|main|cross|nagar|layout|garden|gardens|circle|town|colony|extension|hobli)\b/i;

export function rideArea(address: string | null | undefined): string | null {
  if (!address) return null;
  const segments = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;

  // Drop state/PIN/country lines (no hardcoded single city).
  const trimmed = segments.filter((s) => !STATE_PIN_COUNTRY.test(s) && !PIN.test(s));
  // The last remaining segment is usually the city — drop it when a more
  // specific locality exists before it.
  const candidates = trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;

  const meaningful = candidates.filter((s) => !HOUSE_NO.test(s));
  if (meaningful.length === 0) return null;
  const hinted = meaningful.find((s) => LOCALITY_HINT.test(s));
  return hinted ?? meaningful[0];
}
