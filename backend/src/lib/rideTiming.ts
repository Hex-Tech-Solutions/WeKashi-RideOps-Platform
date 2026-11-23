/**
 * When does a scheduled ride's FIRST PICKUP happen?
 *
 * A scheduled ride's `scheduled_for` is the group's SHIFT time (login time for a
 * login ride, shift end for a logout ride) on the chosen date. The first stop's
 * pickup time is stored separately, as an "HH:MM" on ride_pax:
 *   - login ride:  pickups are up to 3 h BEFORE the login time (home -> office)
 *   - logout ride: pickups are at the office, from the shift end up to 1 h AFTER
 * Everything the driver is told about "pickup" (reminders, when the ride unlocks
 * in the app) must count from that first pickup, not from the shift time.
 *
 * All times are India time (IST), the same clock the supervisor typed them in.
 */
const DAY_MIN = 24 * 60;
const IST_OFFSET_MIN = 330;
/** Anything further than this from the shift time is treated as bad data. */
const MAX_OFFSET_MIN = 6 * 60;

/**
 * The instant of the first pickup. Falls back to `scheduledFor` when there is no
 * usable pickup time (airport rides, old rides) or it is on the wrong side of
 * the shift time, i.e. exactly the old behaviour.
 */
export function firstPickupAt(
  scheduledFor: Date,
  type: string | null | undefined,
  firstPickupHHMM: string | null | undefined,
): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(firstPickupHHMM ?? '');
  if (!m) return scheduledFor;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return scheduledFor;
  const pick = hh * 60 + mm;

  // Minutes since IST midnight of the shift time.
  const istMs = scheduledFor.getTime() + IST_OFFSET_MIN * 60_000;
  const shift = Math.floor((((istMs % (DAY_MIN * 60_000)) + DAY_MIN * 60_000) % (DAY_MIN * 60_000)) / 60_000);

  // Signed gap pickup - shift, wrapped over midnight into (-12 h, +12 h].
  let delta = pick - shift;
  if (delta > DAY_MIN / 2) delta -= DAY_MIN;
  else if (delta <= -DAY_MIN / 2) delta += DAY_MIN;

  const ok = type === 'logout' ? delta >= 0 : delta <= 0; // logout: at/after shift; login: at/before
  if (!ok || Math.abs(delta) > MAX_OFFSET_MIN) return scheduledFor;
  return new Date(scheduledFor.getTime() + delta * 60_000);
}
