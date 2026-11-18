import { describe, it, expect } from 'vitest';
import { reminderToSend } from '../src/services/rideReminders.service';

const MIN = 60 * 1000;
const PICKUP = new Date('2026-11-20T10:00:00Z');
const at = (minutesBefore: number) => new Date(PICKUP.getTime() - minutesBefore * MIN);
const longAgo = at(60 * 24 * 7); // assigned a week before

describe('ride pickup reminders', () => {
  it('sends nothing more than 24 hours before pickup', () => {
    expect(reminderToSend(PICKUP, longAgo, at(1500))).toBeNull();
  });

  it('picks the tightest step reached: 24h, then 2h, then 45 min', () => {
    expect(reminderToSend(PICKUP, longAgo, at(1440))?.step).toBe(1440);
    expect(reminderToSend(PICKUP, longAgo, at(600))?.step).toBe(1440);
    expect(reminderToSend(PICKUP, longAgo, at(120))?.step).toBe(120);
    expect(reminderToSend(PICKUP, longAgo, at(90))?.step).toBe(120);
    expect(reminderToSend(PICKUP, longAgo, at(45))?.step).toBe(45);
    expect(reminderToSend(PICKUP, longAgo, at(5))?.step).toBe(45);
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
    expect(reminderToSend(PICKUP, assigned, at(40))?.step).toBe(45);  // the 45-minute step still applies
  });

  it('claimed with under 45 minutes to go: no reminders at all', () => {
    expect(reminderToSend(PICKUP, at(30), at(20))).toBeNull();
  });
});
