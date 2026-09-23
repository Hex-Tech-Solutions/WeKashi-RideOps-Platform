import { prisma } from '../src/lib/prisma';
import { redis } from '../src/lib/redis';

// Ensure test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://rideops:rideops@localhost:5432/rideops_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRY = '15m';
process.env.JWT_REFRESH_EXPIRY = '7d';
process.env.ADMIN_INVITE_TOKEN = 'test-invite-token';
process.env.DEV_OTP_BYPASS = '123456';
process.env.LOG_LEVEL = 'silent';
// Cashfree — a dummy webhook secret so signature-verification unit tests can
// exercise the positive path. No real Cashfree calls are made in tests.
process.env.CASHFREE_WEBHOOK_SECRET = process.env.CASHFREE_WEBHOOK_SECRET ?? 'test-cashfree-webhook-secret';
process.env.CASHFREE_SECRET_KEY = process.env.CASHFREE_SECRET_KEY ?? 'test-cashfree-secret';
process.env.CASHFREE_APP_ID = process.env.CASHFREE_APP_ID ?? 'test-cashfree-app-id';

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});
