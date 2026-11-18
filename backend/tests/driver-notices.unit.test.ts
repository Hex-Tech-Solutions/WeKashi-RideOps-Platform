import { describe, it, expect } from 'vitest';
import { packReminderStep, packDaysLeft } from '../src/services/creditNotices.service';
import { isCreditAlertLevel, CREDITS_LOW_THRESHOLD } from '../src/services/driverNotice.service';

describe('pack-expiry reminders', () => {
  it('maps days left to the 30 / 7 / 1 steps', () => {
    expect(packReminderStep(45)).toBeNull();
    expect(packReminderStep(31)).toBeNull();
    expect(packReminderStep(30)).toBe(30);
    expect(packReminderStep(8)).toBe(30);
    expect(packReminderStep(7)).toBe(7);
    expect(packReminderStep(2)).toBe(7);
    expect(packReminderStep(1)).toBe(1);
  });

  it('sends nothing for an already-expired pack', () => {
    expect(packReminderStep(0)).toBeNull();
    expect(packReminderStep(-2)).toBeNull();
  });

  it('counts whole days, rounding up', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(packDaysLeft(new Date('2026-11-15T00:00:00Z'), now)).toBe(1);
    expect(packDaysLeft(new Date('2026-11-21T12:00:00Z'), now)).toBe(7);
  });
});

describe('low-credit alert levels', () => {
  it('alerts at exactly the low threshold and at zero, nowhere else', () => {
    expect(CREDITS_LOW_THRESHOLD).toBe(2);
    expect([0, 1, 2, 3, 5, 10].filter(isCreditAlertLevel)).toEqual([0, 2]);
  });
});
