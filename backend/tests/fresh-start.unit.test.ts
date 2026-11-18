import { describe, it, expect } from 'vitest';
import { buildTruncateSql, readConfig, KEEP_TABLES } from '../src/scripts/freshStart';

const good = {
  ADMIN_EMAIL: 'Admin@Example.com', ADMIN_PASSWORD: 'abcdefg1',
  SUPERVISOR_EMAIL: 'sup@example.com', SUPERVISOR_PASSWORD: 'abcdefg2',
  VENDOR_EMAIL: 'vendor@example.com', VENDOR_PASSWORD: 'abcdefg3',
};

describe('fresh start script', () => {
  it('truncates every table in one statement, quoted, with cascade', () => {
    expect(buildTruncateSql(['users', 'rides'])).toBe('TRUNCATE TABLE "users", "rides" RESTART IDENTITY CASCADE');
    expect(buildTruncateSql(['we"ird'])).toBe('TRUNCATE TABLE "we""ird" RESTART IDENTITY CASCADE');
  });

  it('always keeps the migration history and PostGIS reference table', () => {
    expect([...KEEP_TABLES].sort()).toEqual(['_prisma_migrations', 'spatial_ref_sys']);
  });

  it('accepts valid input and lower-cases emails', () => {
    const { config, errors } = readConfig(good as unknown as NodeJS.ProcessEnv);
    expect(errors).toEqual([]);
    expect(config?.admin.email).toBe('admin@example.com');
    expect(config?.vendor.company).toBe('Wekashi Cabs'); // default
  });

  it('rejects missing passwords, short passwords, bad or duplicate emails', () => {
    const bad = { ...good, ADMIN_PASSWORD: 'short', SUPERVISOR_EMAIL: 'not-an-email', VENDOR_EMAIL: 'admin@example.com' };
    const { config, errors } = readConfig(bad as unknown as NodeJS.ProcessEnv);
    expect(config).toBeUndefined();
    expect(errors.join('|')).toMatch(/ADMIN_PASSWORD/);
    expect(errors.join('|')).toMatch(/SUPERVISOR_EMAIL/);
    expect(errors.join('|')).toMatch(/different/);
    expect(readConfig({} as NodeJS.ProcessEnv).errors.length).toBeGreaterThanOrEqual(6);
  });
});
