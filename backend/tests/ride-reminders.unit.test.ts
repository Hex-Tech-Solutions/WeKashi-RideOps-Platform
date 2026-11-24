import { describe, it, expect } from 'vitest';
import { reminderToSend } from '../src/services/rideReminders.service';
import { firstPickupAt } from '../src/lib/rideTiming';

const MIN = 60 * 1000;
const PICKUP = new Date('2026-11-20T10:00:00Z');
const at = (minutesBefore: number) => new Date(PICKUP.getTime() - minutesBefore * MIN);
const longAgo = at(60 * 24 * 7); // assigned a week before

describe('ride pickup reminders', () => {
  it('sends nothing more than 24 hours before pickup', () => {
    expect(reminderToSend(PICKUP, longAgo, at(1500))).toBeNull();
  });

  it('picks the tightest step reached: 24h, then 2h, then 60 min', () => {
    expect(reminderToSend(PICKUP, longAgo, at(1440))?.step).toBe(1440);
    expect(reminderToSend(PICKUP, longAgo, at(600))?.step).toBe(1440);
    expect(reminderToSend(PICKUP, longAgo, at(120))?.step).toBe(120);
    expect(reminderToSend(PICKUP, longAgo, at(90))?.step).toBe(120);
    expect(reminderToSend(PICKUP, longAgo, at(60))?.step).toBe(60);
    expect(reminderToSend(PICKUP, longAgo, at(5))?.step).toBe(60);
  });

  it('reports the real minutes left for the message', () => {
    expect(reminderToSend(PICKUP, longAgo, at(100))?.minutesLeft).toBeCloseTo(100, 5);
  });

  it('sends nothing once the pickup time has passed', () => {
    expect(reminderToSend(PICKUP, longAgo, PICKUP)).toBeNull();
    expect(reminderToSend(PICKUP, longAgo, new Date(PICKUP.getTime() + MIN))).toBeNull();
  });

  it('skips a step whose moment was before the ride was assigned', () => {
    const assigned = at(100); // claimed 100 minutes before pickup
    expect(reminderToSend(PICKUP, assigned, at(90))).toBeNull();      // the 2h / 24h steps are already past
    expect(reminderToSend(PICKUP, assigned, at(40))?.step).toBe(60);  // the 60-minute step still applies
  });

  it('claimed with under 60 minutes to go: no reminders at all', () => {
    expect(reminderToSend(PICKUP, at(30), at(20))).toBeNull();
  });
});

// scheduled_for is the shift time; the reminders count from the FIRST PICKUP.
// Times below are India time (UTC+5:30).
describe('first pickup time of a scheduled ride', () => {
  const ist = (iso: string) => new Date(`${iso}+05:30`);

  it('login ride: the first pickup is before the login time', () => {
    const login = ist('2026-11-20T08:30:00'); // shift starts 08:30
    expect(firstPickupAt(login, 'login', '06:30').toISOString()).toBe(ist('2026-11-20T06:30:00').toISOString());
    expect(firstPickupAt(login, 'login', '08:30').toISOString()).toBe(login.toISOString());
  });

  it('login ride just after midnight: the first pickup is the evening before', () => {
    const login = ist('2026-11-20T01:00:00');
    expect(firstPickupAt(login, 'login', '22:30').toISOString()).toBe(ist('2026-11-19T22:30:00').toISOString());
  });

  it('logout ride: the first pickup is at or after the shift end', () => {
    const end = ist('2026-11-20T18:30:00');
    expect(firstPickupAt(end, 'logout', '19:10').toISOString()).toBe(ist('2026-11-20T19:10:00').toISOString());
  });

  it('logout ride just before midnight: the pickup can fall on the next day', () => {
    const end = ist('2026-11-20T23:30:00');
    expect(firstPickupAt(end, 'logout', '00:15').toISOString()).toBe(ist('2026-11-21T00:15:00').toISOString());
  });

  it('falls back to the shift time when there is no usable pickup time', () => {
    const login = ist('2026-11-20T08:30:00');
    expect(firstPickupAt(login, 'login', null)).toBe(login);
    expect(firstPickupAt(login, 'login', undefined)).toBe(login);
    expect(firstPickupAt(login, 'login', 'soon')).toBe(login);
    expect(firstPickupAt(login, 'login', '25:99')).toBe(login);
    expect(firstPickupAt(login, 'airport', null)).toBe(login);
  });

  it('falls back when the pickup is on the wrong side of the shift or absurdly far', () => {
    const login = ist('2026-11-20T08:30:00');
    expect(firstPickupAt(login, 'login', '09:15')).toBe(login);   // after the login time
    expect(firstPickupAt(login, 'login', '01:00')).toBe(login);   // 7.5 h before: bad data
    const end = ist('2026-11-20T18:30:00');
    expect(firstPickupAt(end, 'logout', '17:45')).toBe(end);      // before the shift end
  });

  it('the 60-minute reminder lands before the first pickup, not before login', () => {
    const login = ist('2026-11-20T08:30:00');
    const pickup = firstPickupAt(login, 'login', '06:30');
    const longBefore = new Date(pickup.getTime() - 7 * 24 * 60 * MIN);
    const at0545 = ist('2026-11-20T05:45:00');
    expect(reminderToSend(pickup, longBefore, at0545)?.step).toBe(60);
    // 60 min before LOGIN (07:45) is already past the pickup: nothing is sent then.
    expect(reminderToSend(pickup, longBefore, ist('2026-11-20T07:45:00'))).toBeNull();
  });
});
