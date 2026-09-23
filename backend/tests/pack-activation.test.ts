import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { activateFromWebhook } from '../src/services/packOrder.service';
import { availableCredits } from '../src/services/creditPack.service';

// Verifies the idempotent activation guard (Req 6.6): confirm + webhook for the
// same order must create exactly one CreditPack.

let vendorId: string;
let driverId: string;

beforeAll(async () => {
  const vendorUser = await prisma.user.create({
    data: { email: `pack-ven-${Date.now()}@test.com`, passwordHash: 'x', role: 'vendor', fullName: 'Ven' },
  });
  const vendor = await prisma.vendor.create({
    data: {
      vendorCode: `VND-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      name: 'Pack Vendor', contactName: 'C', contactPhone: '+919999999999',
      contactEmail: vendorUser.email, userId: vendorUser.id,
    },
  });
  vendorId = vendor.id;
  const phone = `+91${Math.floor(7000000000 + Math.random() * 2999999999)}`;
  const d = await prisma.driver.create({
    data: { phone, fullName: 'Pack Driver', vendorId, status: 'active', kycStatus: 'approved' },
  });
  driverId = d.id;
});

describe('idempotent pack activation (Req 6.6)', () => {
  it('activates exactly once across two webhook deliveries for the same order', async () => {
    const orderId = `order_idem_${Date.now()}`;
    await prisma.packOrder.create({
      data: { driverId, packKey: 'p5', credits: 5, amount: 100, gatewayOrderId: orderId, status: 'created' },
    });

    const first = await activateFromWebhook(orderId, 'pay_1');
    const second = await activateFromWebhook(orderId, 'pay_1'); // duplicate delivery

    expect(first.activated).toBe(true);
    expect(second.activated).toBe(false); // no-op

    const packs = await prisma.creditPack.findMany({ where: { driverId, packOrderId: { not: null } } });
    expect(packs).toHaveLength(1);
    expect(await availableCredits(driverId)).toBe(5);

    const order = await prisma.packOrder.findUnique({ where: { gatewayOrderId: orderId } });
    expect(order?.status).toBe('paid');
    expect(order?.activatedPackId).toBe(packs[0].id);
  });

  it('ignores a webhook for an unknown order', async () => {
    const res = await activateFromWebhook('order_does_not_exist', 'pay_x');
    expect(res.activated).toBe(false);
  });
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM credit_packs WHERE driver_id = '${driverId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM pack_orders WHERE driver_id = '${driverId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM drivers WHERE id = '${driverId}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM vendors WHERE id = '${vendorId}'`);
});
