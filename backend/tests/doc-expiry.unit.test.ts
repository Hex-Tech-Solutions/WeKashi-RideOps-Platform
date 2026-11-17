import { describe, it, expect } from 'vitest';
import { reminderStep, daysUntil } from '../src/services/docExpiry.service';

describe('document expiry reminders (#13)', () => {
  it('picks the tightest step reached, or null beyond 30 days', () => {
    expect(reminderStep(45)).toBeNull();
    expect(reminderStep(31)).toBeNull();
    expect(reminderStep(30)).toBe(30);
    expect(reminderStep(16)).toBe(30);
    expect(reminderStep(15)).toBe(15);
    expect(reminderStep(10)).toBe(15);
    expect(reminderStep(7)).toBe(7);
    expect(reminderStep(2)).toBe(7);
    expect(reminderStep(1)).toBe(1);
    expect(reminderStep(0)).toBe(0);
    expect(reminderStep(-3)).toBe(0);
  });

  it('counts whole days left, rounding up', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(daysUntil(new Date('2026-11-15T00:00:00Z'), now)).toBe(1);
    expect(daysUntil(new Date('2026-11-21T12:00:00Z'), now)).toBe(7);
    expect(daysUntil(new Date('2026-11-14T11:00:00Z'), now)).toBe(0);
  });
});
