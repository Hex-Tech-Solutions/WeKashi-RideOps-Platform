import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { redis } from '../src/lib/redis';
import { prisma, createTestServer, createTestVendor, createTestDriver } from './helpers';

describe('OTP rate limiting', () => {
  const { app } = createTestServer();
  const testPhone = '+919888888888';

  beforeEach(async () => {
    // Clean up Redis and DB state for this phone
    await redis.del(`otp:ratelimit:${testPhone}`);
    await redis.del(`otp:attempts:${testPhone}`);
    await prisma.driverOtp.deleteMany({ where: { phone: testPhone } });
  });

  afterEach(async () => {
    await redis.del(`otp:ratelimit:${testPhone}`);
    await redis.del(`otp:attempts:${testPhone}`);
    await prisma.driverOtp.deleteMany({ where: { phone: testPhone } });
  });

  it('allows up to 5 OTP requests within the window', async () => {
    for (let i = 1; i <= 5; i++) {
      const response = await request(app)
        .post('/api/driver/auth/request-otp')
        .send({ phone: testPhone });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('OTP sent successfully');
    }
  });

  it('returns 429 on the 6th OTP request in 10 minutes', async () => {
    // Make 5 successful requests
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/driver/auth/request-otp')
        .send({ phone: testPhone });
    }

    // 6th request should be rate-limited
    const response = await request(app)
      .post('/api/driver/auth/request-otp')
      .send({ phone: testPhone });

    expect(response.status).toBe(429);
  });

  it('returns 401 for wrong OTP', async () => {
    // First request an OTP
    await request(app)
      .post('/api/driver/auth/request-otp')
      .send({ phone: testPhone });

    // Try with wrong OTP
    const response = await request(app)
      .post('/api/driver/auth/verify-otp')
      .send({ phone: testPhone, otp: '000000' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_OTP');
  });

  it('returns 429 after 5 failed verification attempts', async () => {
    // Request an OTP first
    await request(app)
      .post('/api/driver/auth/request-otp')
      .send({ phone: testPhone });

    // Make 5 wrong attempts
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/driver/auth/verify-otp')
        .send({ phone: testPhone, otp: '000000' });
    }

    // 6th wrong attempt should be rate-limited
    const response = await request(app)
      .post('/api/driver/auth/verify-otp')
      .send({ phone: testPhone, otp: '000000' });

    expect(response.status).toBe(429);
  });

  it('accepts DEV_OTP_BYPASS in non-production mode for an active driver', async () => {
    // Create a driver with this phone
    const { vendor } = await createTestVendor();
    await prisma.driver.upsert({
      where: { phone: testPhone },
      update: { status: 'active', kycStatus: 'approved', vendorId: vendor.id },
      create: {
        phone: testPhone,
        fullName: 'Test Driver OTP',
        vendorId: vendor.id,
        status: 'active',
        kycStatus: 'approved',
      },
    });

    const response = await request(app)
      .post('/api/driver/auth/verify-otp')
      .send({ phone: testPhone, otp: '123456' }); // DEV_OTP_BYPASS value

    // Should succeed (200) since DEV_OTP_BYPASS=123456 is set in setup.ts
    expect(response.status).toBe(200);
    expect(response.body.accessToken).toBeTruthy();
    expect(response.body.refreshToken).toBeTruthy();

    // Cleanup
    await prisma.driver.delete({ where: { phone: testPhone } });
    await prisma.vendor.delete({ where: { id: vendor.id } });
  });
});
