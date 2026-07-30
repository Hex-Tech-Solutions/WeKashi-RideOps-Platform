import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  prisma,
  createTestServer,
  createTestUser,
  createTestVendor,
  createTestDriver,
  createBroadcastingRide,
} from './helpers';

describe('Race condition: concurrent ride acceptance', () => {
  let supervisorId: string;
  let vendorId: string;
  let rideId: string;
  let driverTokens: string[];
  let driverIds: string[];
  const { app } = createTestServer();

  beforeEach(async () => {
    // Create supervisor
    const { user: supervisor } = await createTestUser({
      role: 'supervisor',
      email: `race-sup-${Date.now()}@test.com`,
    });
    supervisorId = supervisor.id;

    // Create vendor
    const { vendor } = await createTestVendor();
    vendorId = vendor.id;

    // Create 10 drivers
    driverTokens = [];
    driverIds = [];
    for (let i = 0; i < 10; i++) {
      const { driver, accessToken } = await createTestDriver(vendorId);
      driverIds.push(driver.id);
      driverTokens.push(accessToken);
    }

    // Create a broadcasting ride
    rideId = await createBroadcastingRide(supervisorId);

    // Create offer records for all drivers
    await prisma.rideOffer.createMany({
      data: driverIds.map((driverId) => ({ rideId, driverId, response: 'pending' })),
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    // Clean up in dependency order
    await prisma.rideOffer.deleteMany({ where: { rideId } });
    await prisma.ride.deleteMany({ where: { id: rideId } });
    await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
    await prisma.vendor.deleteMany({ where: { id: vendorId } });
    await prisma.user.deleteMany({ where: { id: supervisorId } });
  });

  it('exactly one driver wins and nine get 409 when 10 concurrent requests arrive', async () => {
    // Fire all 10 requests concurrently
    const requests = driverTokens.map((token) =>
      request(app)
        .post(`/api/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${token}`)
        .send(),
    );

    const responses = await Promise.all(requests);

    const successes = responses.filter((r) => r.status === 200);
    const conflicts = responses.filter((r) => r.status === 409);
    const others = responses.filter((r) => r.status !== 200 && r.status !== 409);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(9);
    expect(others).toHaveLength(0);

    // Verify ride is assigned in DB
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    expect(ride?.status).toBe('assigned');
    expect(ride?.driverId).toBeTruthy();

    // Verify exactly one accepted offer
    const acceptedOffers = await prisma.rideOffer.findMany({
      where: { rideId, response: 'accepted' },
    });
    expect(acceptedOffers).toHaveLength(1);

    // The winning driver must be the one that got 200
    const winningDriverId = ride?.driverId;
    expect(acceptedOffers[0].driverId).toBe(winningDriverId);
  });

  it('the accepted offer driver matches the ride assigned driver', async () => {
    const requests = driverTokens.map((token) =>
      request(app)
        .post(`/api/rides/${rideId}/accept`)
        .set('Authorization', `Bearer ${token}`)
        .send(),
    );

    await Promise.all(requests);

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    const acceptedOffer = await prisma.rideOffer.findFirst({
      where: { rideId, response: 'accepted' },
    });

    expect(ride?.driverId).toBe(acceptedOffer?.driverId);
  });
});
