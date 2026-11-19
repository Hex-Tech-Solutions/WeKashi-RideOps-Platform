/**
 * Area / locality of a full address, e.g. "Halasuru" from
 * "10, Mahatma Gandhi Rd, Halasuru, ..., Bengaluru, Karnataka 560001, India".
 *
 * Same rules as the driver app's src/lib/rideArea.ts (keep the two in step):
 * the highlighted line on the ride card. Sent in the ride push so the native
 * incoming-ride card shows the same line.
 */
const PIN = /^\d{6}$/;
const HOUSE_NO = /^(no\.?\s*)?\d+[a-z]?$/i;
const STATE_PIN_COUNTRY = /\b\d{6}\b|karnataka|maharashtra|tamil nadu|telangana|kerala|andhra pradesh|delhi|india/i;
const LOCALITY_HINT = /\b(rd|road|marg|main|cross|nagar|layout|garden|gardens|circle|town|colony|extension|hobli)\b/i;

export function rideArea(address: string | null | undefined): string | null {
  if (!address) return null;
  const segments = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return null;
  const trimmed = segments.filter((s) => !STATE_PIN_COUNTRY.test(s) && !PIN.test(s));
  const candidates = trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
  const meaningful = candidates.filter((s) => !HOUSE_NO.test(s));
  if (meaningful.length === 0) return null;
  const hinted = meaningful.find((s) => LOCALITY_HINT.test(s));
  return hinted ?? meaningful[0];
}
