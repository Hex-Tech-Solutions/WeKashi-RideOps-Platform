import { Fragment, type ReactNode } from "react";

/**
 * Bold the most recognizable locality/landmark in an address so a driver can
 * tell at a glance which side of town a ride is on.
 *
 * Indian addresses look like:
 *   "10, Mahatma Gandhi Rd, Halasuru, Yellappa Garden, Sivanchetti Gardens,
 *    Bengaluru, Karnataka 560001, India"
 *
 * Heuristic (in priority order), skipping pure house/plot numbers, the city,
 * state, PIN and country:
 *   1. the first segment that looks like a road (Rd / Road / Marg / Main / Cross)
 *   2. otherwise the first meaningful locality segment
 */
const CITY_STATE_NOISE = /\b(bengaluru|bangalore|karnataka|india)\b/i;
const PIN = /^\d{6}$/;
const HOUSE_NO = /^(no\.?\s*)?\d+[a-z]?$/i; // "10", "No 27", "12B"
const ROAD_HINT = /\b(rd|road|marg|main|cross|highway|nagar|layout)\b/i;

function pickHighlight(segments: string[]): string | null {
  const meaningful = segments.filter((s) => {
    const t = s.trim();
    if (!t) return false;
    if (PIN.test(t)) return false;
    if (HOUSE_NO.test(t)) return false;
    if (CITY_STATE_NOISE.test(t) && t.split(" ").length <= 2) return false;
    return true;
  });
  if (meaningful.length === 0) return null;
  // Prefer a road/locality-type segment.
  const road = meaningful.find((s) => ROAD_HINT.test(s));
  return (road ?? meaningful[0]).trim();
}

/**
 * Render an address with the key locality bolded. Case-insensitive match on the
 * chosen segment; everything else stays muted.
 */
export function HighlightedAddress({
  address,
  className,
}: {
  address: string;
  className?: string;
}): ReactNode {
  if (!address) return null;
  const segments = address.split(",");
  const key = pickHighlight(segments);
  if (!key) return <span className={className}>{address}</span>;

  const idx = address.toLowerCase().indexOf(key.toLowerCase());
  if (idx < 0) return <span className={className}>{address}</span>;

  const before = address.slice(0, idx);
  const match = address.slice(idx, idx + key.length);
  const after = address.slice(idx + key.length);

  return (
    <span className={className}>
      {before}
      <Fragment>
        <span className="font-semibold text-foreground">{match}</span>
      </Fragment>
      {after}
    </span>
  );
}
