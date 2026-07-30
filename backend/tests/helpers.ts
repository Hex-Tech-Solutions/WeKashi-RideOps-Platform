import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { signAccessToken } from '../src/lib/jwt';
import http from 'http';
import { createApp } from '../src/app';
import { Server as IoServer } from 'socket.io';

export const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

/**
 * Create a minimal mock IoServer for tests
 */
export function createMockIo(): IoServer {
  const mockOf = () => ({
    to: () => ({ emit: () => {} }),
    emit: () => {},
  });

  return {
    of: mockOf,
    adapter: () => {},
  } as unknown as IoServer;
}

export function createTestServer() {
  const io = createMockIo();
  const app = createApp(io);
  const server = http.createServer(app);
  return { app, server, io };
}

export async function createTestUser(overrides: {
  email?: string;
  role?: 'admin' | 'supervisor' | 'vendor';
  fullName?: string;
} = {}) {
  const email = overrides.email ?? `test-${Date.now()}@example.com`;
  const role = overrides.role ?? 'supervisor';
  const fullName = overrides.fullName ?? 'Test User';
  const passwordHash = await bcrypt.hash('TestPass123!', 10);

  const user = await prisma.user.create({
    data: { email, passwordHash, role, fullName },
  });

  const accessToken = signAccessToken({ sub: user.id, role });
  return { user, accessToken };
}

export async function createTestVendor() {
  const { user, accessToken } = await createTestUser({ role: 'vendor', email: `vendor-${Date.now()}@test.com` });

  const vendor = await prisma.vendor.create({
    data: {
      name: 'Test Vendor',
      contactName: 'Test Contact',
      contactPhone: '+919999999999',
      contactEmail: user.email,
      userId: user.id,
    },
  });

  return { user, vendor, accessToken };
}

export async function createTestDriver(vendorId: string) {
  const phone = `+91${Math.floor(7000000000 + Math.random() * 2999999999)}`;
  const driver = await prisma.driver.create({
    data: {
      phone,
      fullName: 'Test Driver',
      vendorId,
      status: 'active',
      kycStatus: 'approved',
    },
  });

  const accessToken = signAccessToken({
    sub: driver.id,
    role: 'driver',
    vendorId,
  });

  return { driver, accessToken };
}

export async function createBroadcastingRide(supervisorId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rides (
      id, type, status, supervisor_id,
      pickup_point, drop_point,
      pickup_address, drop_address,
      pax_count, capacity,
      broadcast_started_at, broadcast_expires_at, created_at
    ) VALUES (
      gen_random_uuid(),
      'login'::"RideType",
      'broadcasting'::"RideStatus",
      ${supervisorId},
      ST_SetSRID(ST_MakePoint(73.8567, 18.5204), 4326)::geography,
      ST_SetSRID(ST_MakePoint(73.8446, 18.5314), 4326)::geography,
      'Pickup Address Test',
      'Drop Address Test',
      1,
      4,
      NOW(),
      NOW() + INTERVAL '3 minutes',
      NOW()
    )
    RETURNING id
  `;
  return rows[0].id;
}

export async function cleanupTestData(tables: string[]) {
  for (const table of tables.reverse()) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE true`);
  }
}
