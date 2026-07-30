import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { prisma, createTestServer, createTestUser, createTestVendor, createTestDriver } from './helpers';

describe('Role-based authentication and authorization', () => {
  const { app } = createTestServer();

  let supervisorToken: string;
  let driverToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const { accessToken: supToken } = await createTestUser({
      role: 'supervisor',
      email: `roletest-sup-${Date.now()}@test.com`,
    });
    supervisorToken = supToken;

    const { accessToken: admToken } = await createTestUser({
      role: 'admin',
      email: `roletest-admin-${Date.now()}@test.com`,
    });
    adminToken = admToken;

    const { vendor } = await createTestVendor();
    const { accessToken: drvToken } = await createTestDriver(vendor.id);
    driverToken = drvToken;
  });

  it('returns 401 when no token is provided', async () => {
    const response = await request(app)
      .get('/api/rides')
      .send();

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for an expired token', async () => {
    const expiredToken = jwt.sign(
      { sub: 'fake-id', role: 'supervisor' },
      'test-access-secret',
      { expiresIn: -1 }, // already expired
    );

    const response = await request(app)
      .get('/api/rides')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send();

    expect(response.status).toBe(401);
  });

  it('returns 401 for a token signed with wrong secret', async () => {
    const badToken = jwt.sign(
      { sub: 'fake-id', role: 'supervisor' },
      'wrong-secret',
      { expiresIn: '15m' },
    );

    const response = await request(app)
      .get('/api/rides')
      .set('Authorization', `Bearer ${badToken}`)
      .send();

    expect(response.status).toBe(401);
  });

  it('returns 403 when supervisor hits admin-only route', async () => {
    const response = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send();

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when driver hits admin-only route', async () => {
    const response = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${driverToken}`)
      .send();

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when supervisor hits driver-only location update', async () => {
    const response = await request(app)
      .post('/api/drivers/some-id/location')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ lat: 18.5, lng: 73.8 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('allows admin to access admin route', async () => {
    const response = await request(app)
      .get('/api/vendors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    // Should not be 401 or 403 (may be 200 or other status based on DB state)
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it('allows supervisor to access rides', async () => {
    const response = await request(app)
      .get('/api/rides')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send();

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it('returns 403 when driver tries to create a ride', async () => {
    const response = await request(app)
      .post('/api/rides')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        type: 'login',
        pickupPoint: { lat: 18.5, lng: 73.8 },
        dropPoint: { lat: 18.53, lng: 73.84 },
        pickupAddress: 'Test pickup',
        dropAddress: 'Test drop',
        employeeIds: [],
      });

    expect(response.status).toBe(403);
  });
});
