import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import {
  availableCredits,
  grantJoiningBonus,
  activatePurchasedPack,
  consumeOneCredit,
  listPacks,
} from '../src/services/creditPack.service';
import { PACK_VALIDITY_DAYS } from '../src/lib/creditPacks';

// DB-backed tests for the Credit_Ledger. Require a migrated Postgres (the same
// database the rest of the integration suite uses).

const DAY = 24 * 60 * 60 * 1000;
let vendorId: string;
let driverId: string;

async function makeDriver(): Promise<string> {
  const phone = `+91${Math.floor(7000000000 + Math.random() * 2999999999)}`;
  const d = await prisma.driver.create({
    data: { phone, fullName: 'Ledger Driver', vendorId, status: 'active', kycStatus: 'approved' },
  });
  return d.id;
}

/** Insert a pack directly with an explicit expiry so we control ordering. */
async function seedPack(dId: string, credits: number, expiresInDays: number, createdOffsetMs = 0) {
  const now = new Date(Date.now() + createdOffsetMs);
  const expiresAt = new Date(Date.now() + expiresInDays * DAY);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO credit_packs
      (id, driver_id, source, credits_total, credits_remaining, price_paid, activated_at, expires_at, status, created_at)
    VALUES
      (gen_random_uuid(), ${dId}, 'purchase', ${credits}, ${credits}, 0, ${now}, ${expiresAt}, 'active', ${now})
    RETURNING id`;
  return rows[0].id;
}

/** A completed ride row we can burn a credit against. */
async function makeCompletedRide(dId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rides (
      id, type, status, supervisor_id, driver_id,
      pickup_point, drop_point, pickup_address, drop_address,
      pax_count, capacity, created_at, completed_at
    ) VALUES (
      gen_random_uuid(), 'login'::"RideType", 'completed'::"RideStatus",
      ${supervisorId}, ${dId},
      ST_SetSRID(ST_MakePoint(73.85, 18.52), 4326)::geography,
      ST_SetSRID(ST_MakePoint(73.84, 18.53), 4326)::geography,
      'P', 'D', 1, 4, NOW(), NOW()
    ) RETURNING id`;
  return rows[0].id;
}

let supervisorId: string;

beforeAll(async () => {
  const sup = await prisma.user.create({
    data: { email: `ledger-sup-${Date.now()}@test.com`, passwordHash: 'x', role: 'supervisor', fullName: 'Sup' },
  });
  supervisorId = sup.id;
  const vendorUser = await prisma.user.create({
    data: { email: `ledger-ven-${Date.now()}@test.com`, passwordHash: 'x', role: 'vendor', fullName: 'Ven' },
  });
  const vendor = await prisma.vendor.create({
    data: {
      vendorCode: `VND-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Ledger Vendor', contactName: 'C', contactPhone: '+919999999999',
      contactEmail: vendorUser.email, userId: vendorUser.id,
    },
  });
  vendorId = vendor.id;
});

beforeEach(async () => {
  driverId = await makeDriver();
});

describe('availableCredits (Req 8.3 / 9.3)', () => {
  it('sums remaining credits over active, unexpired packs only', async () => {
    await seedPack(driverId, 5, 100);
    await seedPack(driverId, 10, 200);
    expect(await availableCredits(driverId)).toBe(15);
  });

  it('excludes expired packs', async () => {
    await seedPack(driverId, 5, -1); // already expired
    await seedPack(driverId, 3, 100);
    expect(await availableCredits(driverId)).toBe(3);
  });
});

describe('consumeOneCredit (Req 10)', () => {
  it('burns exactly one credit from the oldest-expiring pack', async () => {
    const soon = await seedPack(driverId, 5, 10);   // expires first
    const later = await seedPack(driverId, 5, 100);
    const rideId = await makeCompletedRide(driverId);

    await prisma.$transaction((tx) => consumeOneCredit(tx, driverId, rideId));

    const soonPack = await prisma.creditPack.findUnique({ where: { id: soon } });
    const laterPack = await prisma.creditPack.findUnique({ where: { id: later } });
    expect(soonPack?.creditsRemaining).toBe(4);
    expect(laterPack?.creditsRemaining).toBe(5);
    expect(await availableCredits(driverId)).toBe(9);
  });

  it('is idempotent — a second burn for the same ride does nothing', async () => {
    await seedPack(driverId, 2, 50);
    const rideId = await makeCompletedRide(driverId);
    await prisma.$transaction((tx) => consumeOneCredit(tx, driverId, rideId));
    await prisma.$transaction((tx) => consumeOneCredit(tx, driverId, rideId));
    expect(await availableCredits(driverId)).toBe(1);
  });

  it('burns exactly one on an equal-expiry tie', async () => {
    await seedPack(driverId, 5, 30);
    await seedPack(driverId, 5, 30); // same expiry
    const rideId = await makeCompletedRide(driverId);
    await prisma.$transaction((tx) => consumeOneCredit(tx, driverId, rideId));
    expect(await availableCredits(driverId)).toBe(9);
  });

  it('marks a pack exhausted when its last credit is used', async () => {
    const only = await seedPack(driverId, 1, 40);
    const rideId = await makeCompletedRide(driverId);
    await prisma.$transaction((tx) => consumeOneCredit(tx, driverId, rideId));
    const pack = await prisma.creditPack.findUnique({ where: { id: only } });
    expect(pack?.status).toBe('exhausted');
    expect(await availableCredits(driverId)).toBe(0);
  });

  it('burns nothing when the driver has no credits (ride still completes)', async () => {
    const rideId = await makeCompletedRide(driverId);
    await prisma.$transaction((tx) => consumeOneCredit(tx, driverId, rideId));
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    expect(ride?.creditConsumed).toBe(false);
  });
});

describe('grantJoiningBonus (Req 7.3)', () => {
  it('grants exactly one bonus and never twice', async () => {
    await grantJoiningBonus(driverId);
    await grantJoiningBonus(driverId);
    const bonuses = await prisma.creditPack.findMany({ where: { driverId, source: 'joining_bonus' } });
    expect(bonuses).toHaveLength(1);
    expect(await availableCredits(driverId)).toBe(1);
  });
});

describe('activatePurchasedPack (Req 6.3 / 8.1)', () => {
  it('creates a full-credit pack expiring 365 days out', async () => {
    const order = await prisma.packOrder.create({
      data: {
        driverId, packKey: 'p10', credits: 10, amount: 159,
        gatewayOrderId: `order_test_${Date.now()}`, status: 'created',
      },
    });
    const pack = await prisma.$transaction((tx) => activatePurchasedPack(tx, driverId, 'p10', order.id));
    const stored = await prisma.creditPack.findUnique({ where: { id: pack.id } });
    expect(stored?.creditsRemaining).toBe(10);
    const days = Math.round(((stored!.expiresAt.getTime() - stored!.activatedAt.getTime()) / DAY));
    expect(days).toBe(PACK_VALIDITY_DAYS);
  });
});

afterAll(async () => {
  // Best-effort cleanup of rows created by this file.
  await prisma.$executeRawUnsafe(`DELETE FROM credit_packs WHERE driver_id IN (SELECT id FROM drivers WHERE vendor_id = '${vendorId}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM pack_orders WHERE driver_id IN (SELECT id FROM drivers WHERE vendor_id = '${vendorId}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM rides WHERE supervisor_id = '${supervisorId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE vendor_id = '${vendorId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM vendors WHERE id = '${vendorId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${supervisorId}'`);
});
