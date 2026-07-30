import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const BCRYPT_ROUNDS = 12;

async function main() {
  console.log('Seeding database...');

  // ─── Admin ─────────────────────────────────────────────────────────────────
  const adminPassword = await bcrypt.hash('Admin123!', BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@rideops.dev' },
    update: {},
    create: {
      email: 'admin@rideops.dev',
      passwordHash: adminPassword,
      role: 'admin',
      fullName: 'System Admin',
    },
  });
  console.log('Admin created:', admin.id);

  // ─── Vendor User + Vendor Record ───────────────────────────────────────────
  const vendorPassword = await bcrypt.hash('Vendor123!', BCRYPT_ROUNDS);
  const vendorUser = await prisma.user.upsert({
    where: { email: 'vendor@rideops.dev' },
    update: {},
    create: {
      email: 'vendor@rideops.dev',
      passwordHash: vendorPassword,
      role: 'vendor',
      fullName: 'Vendor Manager',
      org: 'CabCo Transport Ltd',
    },
  });

  const vendor = await prisma.vendor.upsert({
    where: { userId: vendorUser.id },
    update: {},
    create: {
      name: 'CabCo Transport Ltd',
      contactName: 'Vendor Manager',
      contactPhone: '+919100000001',
      contactEmail: 'vendor@rideops.dev',
      userId: vendorUser.id,
      vendorCode: 'VND-CABCO1',
      payoutDetails: { bankName: 'State Bank', accountNo: 'XXXX1234', ifsc: 'SBIN0001234' },
    },
  });
  console.log('Vendor created:', vendor.id);

  // ─── Supervisor ────────────────────────────────────────────────────────────
  const supervisorPassword = await bcrypt.hash('Super123!', BCRYPT_ROUNDS);
  const supervisor = await prisma.user.upsert({
    where: { email: 'supervisor@rideops.dev' },
    update: {},
    create: {
      email: 'supervisor@rideops.dev',
      passwordHash: supervisorPassword,
      role: 'supervisor',
      fullName: 'Site Supervisor',
      org: 'TechCorp India',
    },
  });
  console.log('Supervisor created:', supervisor.id);

  // ─── Vehicles ──────────────────────────────────────────────────────────────
  const vehicle1 = await prisma.vehicle.upsert({
    where: { regNo: 'MH12AB1234' },
    update: {},
    create: {
      vendorId: vendor.id,
      regNo: 'MH12AB1234',
      capacity: 4,
      fuelType: 'CNG',
      documents: { rc: 'RC001', insurance: 'INS001', fitness: 'FIT001' },
    },
  });

  const vehicle2 = await prisma.vehicle.upsert({
    where: { regNo: 'MH12CD5678' },
    update: {},
    create: {
      vendorId: vendor.id,
      regNo: 'MH12CD5678',
      capacity: 7,
      fuelType: 'Diesel',
      documents: { rc: 'RC002', insurance: 'INS002', fitness: 'FIT002' },
    },
  });

  // ─── Drivers ───────────────────────────────────────────────────────────────
  const driverPhones = ['+919000000001', '+919000000002', '+919000000003'];
  const driverNames = ['Ramesh Kumar', 'Suresh Sharma', 'Mahesh Patel'];

  const drivers = [];
  for (let i = 0; i < 3; i++) {
    const driver = await prisma.driver.upsert({
      where: { phone: driverPhones[i] },
      update: {},
      create: {
        phone: driverPhones[i],
        fullName: driverNames[i],
        vendorId: vendor.id,
        status: 'active',
        kycStatus: 'approved',
        vehicleId: i === 0 ? vehicle1.id : i === 1 ? vehicle2.id : undefined,
        rating: 4.5 + i * 0.1,
      },
    });
    drivers.push(driver);
    console.log(`Driver ${i + 1} created:`, driver.id, driver.phone);
  }

  // ─── Sample Employees ──────────────────────────────────────────────────────
  const employeeSeed = [
    {
      empId: 'EMP001',
      name: 'Alice Johnson',
      gender: 'female',
      phone: '+919200000001',
      pickupLat: 18.5204,
      pickupLng: 73.8567,
      dropLat: 18.5314,
      dropLng: 73.8446,
      pickupAddress: '123 MG Road, Pune',
      dropAddress: 'TechPark, Hinjewadi, Pune',
      shiftStart: '09:00',
      shiftEnd: '18:00',
    },
    {
      empId: 'EMP002',
      name: 'Bob Smith',
      gender: 'male',
      phone: '+919200000002',
      pickupLat: 18.5300,
      pickupLng: 73.8600,
      dropLat: 18.5314,
      dropLng: 73.8446,
      pickupAddress: '456 FC Road, Pune',
      dropAddress: 'TechPark, Hinjewadi, Pune',
      shiftStart: '09:00',
      shiftEnd: '18:00',
    },
    {
      empId: 'EMP003',
      name: 'Carol Williams',
      gender: 'female',
      phone: '+919200000003',
      pickupLat: 18.5100,
      pickupLng: 73.8500,
      dropLat: 18.5314,
      dropLng: 73.8446,
      pickupAddress: '789 SB Road, Pune',
      dropAddress: 'TechPark, Hinjewadi, Pune',
      shiftStart: '22:00',
      shiftEnd: '06:00',
    },
  ];

  for (const emp of employeeSeed) {
    // Check if employee already exists for supervisor+empId combo
    const existing = await prisma.employee.findUnique({
      where: { supervisorId_empId: { supervisorId: supervisor.id, empId: emp.empId } },
    });

    if (!existing) {
      await prisma.$executeRaw`
        INSERT INTO employees (
          id, supervisor_id, emp_id, name, gender, phone,
          pickup_location, drop_location,
          pickup_address, drop_address,
          shift_start, shift_end, created_at
        ) VALUES (
          gen_random_uuid(),
          ${supervisor.id},
          ${emp.empId},
          ${emp.name},
          ${emp.gender},
          ${emp.phone},
          ST_SetSRID(ST_MakePoint(${emp.pickupLng}, ${emp.pickupLat}), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${emp.dropLng}, ${emp.dropLat}), 4326)::geography,
          ${emp.pickupAddress},
          ${emp.dropAddress},
          ${emp.shiftStart},
          ${emp.shiftEnd},
          NOW()
        )
      `;
      console.log(`Employee ${emp.empId} created`);
    } else {
      console.log(`Employee ${emp.empId} already exists, skipping`);
    }
  }

  console.log('\nSeed complete!');
  console.log('\nLogin credentials:');
  console.log('  Admin:      admin@rideops.dev / Admin123!');
  console.log('  Vendor:     vendor@rideops.dev / Vendor123!');
  console.log('  Supervisor: supervisor@rideops.dev / Super123!');
  console.log('  Drivers:    +919000000001/2/3 (use DEV_OTP_BYPASS env var in development)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
