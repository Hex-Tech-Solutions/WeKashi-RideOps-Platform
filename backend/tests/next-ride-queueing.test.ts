import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import {
  acceptRide,
  advanceRideStatus,
  cancelRide,
} from '../src/services/ride.service';
import { findNearbyDrivers } from '../src/services/driver.service';

// DB-backed tests for next-ride queueing. A finishing driver (in_progress ride
// within 3km of its drop) can accept a broadcast that is held as a queued ride
// and auto-promoted when the active ride terminates.

// Pune-ish coordinates. Drop point and a driver location right next to it (~0m)
// so the driver is "finishing". A far location (>3km) for the negative case.
const DROP_LNG = 73.8446, DROP_LAT = 18.5314;
const NEAR_LNG = 73.8447, NEAR_LAT = 18.5315;   // ~15 m from drop
const FAR_LNG = 73.9500, FAR_LAT = 18.6300;      // ~15 km from drop

let vendorId: string;
let supervisorId: string;

async function makeDriver(lng: number, lat: number): Promise<string> {
  const phone = `+91${Math.floor(7000000000 + Math.random() * 2999999999)}`;
  const d = await prisma.driver.create({
    data: { phone, fullName: 'Q Driver', vendorId, status: 'active', kycStatus: 'approved', isOnline: true, vehicleType: 'sedan' },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE drivers SET current_location = ST_SetSRID(ST_MakePoint($1,$2),4326)::geography WHERE id = $3`,
    lng, lat, d.id,
  );
  // Give the driver a credit so the credit gate passes.
  await prisma.$executeRaw`
    INSERT INTO credit_packs (id, driver_id, source, credits_total, credits_remaining, price_paid, activated_at, expires_at, status, created_at)
    VALUES (gen_random_uuid(), ${d.id}, 'purchase', 10, 10, 159, NOW(), NOW() + INTERVAL '365 days', 'active', NOW())`;
  return d.id;
}

async function makeRide(status: string, driverId: string | null): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO rides (id, type, status, supervisor_id, driver_id,
       pickup_point, drop_point, pickup_address, drop_address, pax_count, capacity,
       broadcast_started_at, broadcast_expires_at, created_at)
     VALUES (gen_random_uuid(), 'login', $1::"RideStatus", $2, $3,
       ST_SetSRID(ST_MakePoint(73.8567,18.5204),4326)::geography,
       ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,
       'P','D',1,4, NOW(), NOW() + INTERVAL '3 minutes', NOW())
     RETURNING id`,
    status, supervisorId, driverId, DROP_LNG, DROP_LAT,
  );
  return rows[0].id;
}

beforeAll(async () => {
  const sup = await prisma.user.create({
    data: { email: `q-sup-${Date.now()}@test.com`, passwordHash: 'x', role: 'supervisor', fullName: 'Sup' },
  });
  supervisorId = sup.id;
  const vu = await prisma.user.create({
    data: { email: `q-ven-${Date.now()}@test.com`, passwordHash: 'x', role: 'vendor', fullName: 'Ven' },
  });
  const v = await prisma.vendor.create({
    data: {
      vendorCode: `VND-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Q Vendor', contactName: 'C', contactPhone: '+919999999999',
      contactEmail: vu.email, userId: vu.id,
    },
  });
  vendorId = v.id;
});

async function dropDriver(driverId: string) {
  await prisma.$executeRawUnsafe(`DELETE FROM ride_offers WHERE driver_id = '${driverId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM credit_packs WHERE driver_id = '${driverId}'`);
  await prisma.$executeRawUnsafe(`UPDATE rides SET driver_id = NULL WHERE driver_id = '${driverId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE id = '${driverId}'`);
}

async function clearDriverRides() {
  await prisma.$executeRawUnsafe(`DELETE FROM ride_offers WHERE ride_id IN (SELECT id FROM rides WHERE supervisor_id = '${supervisorId}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM rides WHERE supervisor_id = '${supervisorId}'`);
}

beforeEach(clearDriverRides);

describe('eligibility (Req 1)', () => {
  it('includes a finishing driver (in_progress within 3km of drop)', async () => {
    const driverId = await makeDriver(NEAR_LNG, NEAR_LAT);
    await makeRide('in_progress', driverId);
    const near = await findNearbyDrivers(DROP_LAT, DROP_LNG, 10, 'sedan');
    expect(near.some((d) => d.id === driverId)).toBe(true);
    await dropDriver(driverId);
  });

  it('excludes a driver on an in_progress ride but far from the drop', async () => {
    const driverId = await makeDriver(FAR_LNG, FAR_LAT);
    await makeRide('in_progress', driverId);
    const near = await findNearbyDrivers(FAR_LAT, FAR_LNG, 20, 'sedan');
    expect(near.some((d) => d.id === driverId)).toBe(false);
    await dropDriver(driverId);
  });

  it('excludes a driver whose active ride is only assigned (not started)', async () => {
    const driverId = await makeDriver(NEAR_LNG, NEAR_LAT);
    await makeRide('assigned', driverId);
    const near = await findNearbyDrivers(DROP_LAT, DROP_LNG, 10, 'sedan');
    expect(near.some((d) => d.id === driverId)).toBe(false);
    await dropDriver(driverId);
  });
});

describe('queued accept + promotion (Req 2, 3)', () => {
  it('queues a broadcast accepted while finishing, then auto-promotes on completion', async () => {
    const driverId = await makeDriver(NEAR_LNG, NEAR_LAT);
    const active = await makeRide('in_progress', driverId);
    const broadcast = await makeRide('broadcasting', null);

    const res = await acceptRide(broadcast, driverId);
    expect(res.queued).toBe(true);

    // The accepted ride is queued behind the active one.
    let q = await prisma.ride.findUnique({ where: { id: broadcast } });
    expect(q?.status).toBe('assigned');
    expect(q?.driverId).toBe(driverId);
    expect(q?.queuedBehindRideId).toBe(active);

    // Complete the active ride → queued ride promotes (marker cleared).
    await advanceRideStatus(active, 'completed', driverId, 'driver');
    q = await prisma.ride.findUnique({ where: { id: broadcast } });
    expect(q?.queuedBehindRideId).toBeNull();
    expect(q?.status).toBe('assigned');

    // Active ride completed → exactly one credit consumed for it.
    const activeRide = await prisma.ride.findUnique({ where: { id: active } });
    expect(activeRide?.creditConsumed).toBe(true);

    await dropDriver(driverId);
  });

  it('rejects a second queued accept (at most one queued ride)', async () => {
    const driverId = await makeDriver(NEAR_LNG, NEAR_LAT);
    await makeRide('in_progress', driverId);
    const b1 = await makeRide('broadcasting', null);
    const b2 = await makeRide('broadcasting', null);

    await acceptRide(b1, driverId);
    await expect(acceptRide(b2, driverId)).rejects.toThrow();

    await dropDriver(driverId);
  });

  it('rejects accepting while mid-ride but NOT finishing', async () => {
    const driverId = await makeDriver(FAR_LNG, FAR_LAT);
    await makeRide('in_progress', driverId);
    const b = await makeRide('broadcasting', null);
    await expect(acceptRide(b, driverId)).rejects.toThrow();
    await dropDriver(driverId);
  });
});

describe('termination resolves queued ride (Req 8)', () => {
  it('promotes the queued ride when the active ride is cancelled', async () => {
    const driverId = await makeDriver(NEAR_LNG, NEAR_LAT);
    const active = await makeRide('assigned', driverId); // supervisor can cancel an assigned ride
    // Manually mark it in_progress + queue behind it via a finishing driver.
    await prisma.$executeRawUnsafe(`UPDATE rides SET status='in_progress' WHERE id='${active}'`);
    const broadcast = await makeRide('broadcasting', null);
    await acceptRide(broadcast, driverId);

    // Force-cancel the active ride (SOS-style) — queued ride should promote.
    await cancelRide(active, supervisorId, 'supervisor', true);
    const q = await prisma.ride.findUnique({ where: { id: broadcast } });
    expect(q?.queuedBehindRideId).toBeNull();
    expect(q?.status).toBe('assigned');

    await dropDriver(driverId);
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM ride_offers WHERE ride_id IN (SELECT id FROM rides WHERE supervisor_id = '${supervisorId}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM rides WHERE supervisor_id = '${supervisorId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM credit_packs WHERE driver_id IN (SELECT id FROM drivers WHERE vendor_id = '${vendorId}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE vendor_id = '${vendorId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM vendors WHERE id = '${vendorId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${supervisorId}'`);
});
