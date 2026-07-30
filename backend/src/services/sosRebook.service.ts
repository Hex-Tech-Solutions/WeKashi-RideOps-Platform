/**
 * SOS Rebook Service
 *
 * Scenarios handled:
 * A) Employees already boarded → pickup from driver's current GPS (stranded passengers)
 * B) No employees boarded yet → pickup from first employee's home (normal route)
 *
 * After creating the new ride:
 * - Posts a system message in the SOS chat so the driver knows a replacement is coming
 * - Broadcasts the new ride to nearby available drivers
 * - Emits sos:rebook_complete to the supervisor's socket
 */

import { prisma } from '../lib/prisma';
import { startRideBroadcast } from '../lib/broadcastSweeper';
import { findNearbyDrivers } from './driver.service';
import { createRidePax } from './ridePax.service';
import { addIssueMessage } from './issue.service';
import { NotFoundError, ValidationError } from '../types';
import { logger } from '../lib/logger';
import { computeFare } from '../lib/pricing';
import { redis } from '../lib/redis';
import type { Server as IoServer } from 'socket.io';

interface RebookResult {
  newRideId: string;
  newRideStatus: string;
  nearbyCount: number;
  employeeCount: number;
  boardedCount: number;
}

// ── Haversine helper ──────────────────────────────────────────────────────────
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function sosRebook(
  issueId: string,
  supervisorId: string,
  io: IoServer,
): Promise<RebookResult> {

  // ── 1. Load SOS issue ──────────────────────────────────────────────────────
  const issue = await prisma.driverIssue.findUnique({
    where: { id: issueId },
    include: { driver: { select: { fullName: true } } },
  });
  if (!issue) throw new NotFoundError('SOS issue not found');
  if (!issue.isSos) throw new ValidationError('This is not an SOS issue');
  if (issue.supervisorId !== supervisorId) throw new ValidationError('Access denied');
  if (!issue.rideId) throw new ValidationError('No ride linked to this SOS');

  const rideId = issue.rideId;
  const driverName = issue.driver?.fullName ?? 'Driver';

  // ── 2. Load original ride ──────────────────────────────────────────────────
  const originalRide = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!originalRide) throw new NotFoundError('Original ride not found');

  // ── 3. Get driver's current GPS ───────────────────────────────────────────
  const driverRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(current_location::geometry) as lat, ST_X(current_location::geometry) as lng
    FROM drivers WHERE id = ${issue.driverId} AND current_location IS NOT NULL
  `;
  const driverLoc = driverRows[0] ?? null;
  if (!driverLoc) {
    throw new ValidationError('Driver GPS not available — ask the driver to share their location first.');
  }

  // ── 4. Get original drop point (office) ───────────────────────────────────
  const dropRows = await prisma.$queryRaw<Array<{
    drop_lat: number; drop_lng: number; drop_address: string;
    vendor_id: string | null; ride_type: string;
  }>>`
    SELECT
      ST_Y(drop_point::geometry) as drop_lat,
      ST_X(drop_point::geometry) as drop_lng,
      drop_address,
      vendor_id,
      type as ride_type
    FROM rides WHERE id = ${rideId}
  `;
  if (!dropRows[0]) throw new NotFoundError('Could not read original ride coordinates');
  const { drop_lat, drop_lng, drop_address, vendor_id, ride_type } = dropRows[0];

  // ── 5. Identify passengers needing rescue ─────────────────────────────────
  const allPax = await prisma.ridePax.findMany({
    where: { rideId },
    include: {
      employee: {
        select: { id: true, name: true, pickupAddress: true },
      },
    },
    orderBy: { seq: 'asc' },
  });

  // Boarded = picked up but NOT yet dropped
  const boarded = allPax.filter((p) => p.pickedAt !== null && !p.droppedAt && !p.noShow);
  // Not yet picked up
  const notPickedUp = allPax.filter((p) => p.pickedAt === null && !p.noShow);

  const employeesToRebook = [...boarded, ...notPickedUp];
  if (employeesToRebook.length === 0) {
    throw new ValidationError('No passengers left to rebook — all are already dropped or marked no-show');
  }

  // ── 6. Force-cancel original ride ─────────────────────────────────────────
  await prisma.ride.update({ where: { id: rideId }, data: { status: 'cancelled' } });
  await redis.del(`ride:broadcast:${rideId}`);
  logger.info({ rideId, issueId }, 'SOS rebook: original ride force-cancelled');

  // ── 7. Determine pickup point ─────────────────────────────────────────────
  let pickupLat: number;
  let pickupLng: number;
  let pickupAddress: string;

  if (boarded.length > 0) {
    // Passengers on board — rescue starts at driver's current GPS
    pickupLat = driverLoc.lat;
    pickupLng = driverLoc.lng;
    const passengerNames = boarded.map((p) => p.employee.name).join(', ');
    pickupAddress = boarded.length === 1
      ? `Driver current location — ${boarded[0].employee.name} on board`
      : `Driver current location — ${boarded.length} passengers on board (${passengerNames})`;
  } else {
    // Nobody boarded — rebook from first employee's home
    const firstEmp = notPickedUp[0];
    const empLocRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(pickup_location::geometry) as lat, ST_X(pickup_location::geometry) as lng
      FROM employees WHERE id = ${firstEmp.employeeId}
    `;
    pickupLat = empLocRows[0]?.lat ?? driverLoc.lat;
    pickupLng = empLocRows[0]?.lng ?? driverLoc.lng;
    pickupAddress = firstEmp.employee.pickupAddress;
  }

  // ── 8. Estimate distance: sum of legs (pickup → each remaining home → office) ──
  // This is more accurate than direct pickup→office straight-line
  let estimatedKm = 0;
  let prevLat = pickupLat;
  let prevLng = pickupLng;

  // For not-yet-picked-up employees, add leg from previous point to their home
  for (const p of notPickedUp) {
    const empRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(pickup_location::geometry) as lat, ST_X(pickup_location::geometry) as lng
      FROM employees WHERE id = ${p.employeeId}
    `;
    if (empRows[0]) {
      estimatedKm += haversineKm(prevLat, prevLng, empRows[0].lat, empRows[0].lng);
      prevLat = empRows[0].lat;
      prevLng = empRows[0].lng;
    }
  }

  // Final leg to office
  estimatedKm += haversineKm(prevLat, prevLng, drop_lat, drop_lng);
  estimatedKm = Math.round(estimatedKm * 10) / 10;

  const price = computeFare(estimatedKm, originalRide.vehicleType as any);
  const paxCount = employeesToRebook.length;
  const capacity = originalRide.capacity;

  // ── 9. Create new ride ────────────────────────────────────────────────────
  const newRideRows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rides (
      id, type, status, supervisor_id, vendor_id,
      pickup_point, drop_point, pickup_address, drop_address,
      distance_km, price, vehicle_type,
      pax_count, capacity,
      broadcast_started_at, broadcast_expires_at, created_at
    ) VALUES (
      gen_random_uuid(),
      ${ride_type}::"RideType",
      'broadcasting'::"RideStatus",
      ${supervisorId},
      ${vendor_id ?? null},
      ST_SetSRID(ST_MakePoint(${pickupLng}, ${pickupLat}), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${drop_lng}, ${drop_lat}), 4326)::geography,
      ${pickupAddress},
      ${drop_address},
      ${estimatedKm},
      ${price},
      ${originalRide.vehicleType ?? null},
      ${paxCount},
      ${capacity},
      NOW(),
      NOW() + INTERVAL '3 minutes',
      NOW()
    )
    RETURNING id
  `;

  const newRideId = newRideRows[0].id;
  const orderedEmployeeIds = employeesToRebook.map((p) => p.employeeId);

  await prisma.rideEmployee.createMany({
    data: orderedEmployeeIds.map((employeeId) => ({ rideId: newRideId, employeeId })),
    skipDuplicates: true,
  });
  await createRidePax(newRideId, orderedEmployeeIds);

  // ── 10. Post system message in SOS chat ───────────────────────────────────
  const chatMessage = boarded.length > 0
    ? `🔄 Ride rebooked (SOS). ${driverName}, please remain at your current location with ${
        boarded.length === 1 ? boarded[0].employee.name : `${boarded.length} passengers`
      }. A replacement driver has been broadcast. New OTPs will be sent once a driver is assigned.`
    : `🔄 Ride cancelled and rebooked (SOS). A replacement driver has been broadcast for all ${paxCount} passenger${paxCount === 1 ? '' : 's'}. New OTPs will be sent once a driver is assigned.`;

  await addIssueMessage(
    issueId,
    { id: supervisorId, role: 'supervisor' },
    chatMessage,
  ).catch((err) => logger.warn({ err }, 'Could not post SOS rebook system message'));

  // Also push the message to the driver's app via socket
  io.of('/driver')
    .to(`driver:${issue.driverId}`)
    .emit('issue:message', {
      issueId,
      message: { body: chatMessage, senderName: 'System', senderRole: 'system' },
    });

  // ── 11. Broadcast new ride ────────────────────────────────────────────────
  await startRideBroadcast(newRideId);

  // Only broadcast to available drivers (no active ride)
  const nearbyDrivers = await findNearbyDrivers(pickupLat, pickupLng, 10, originalRide.vehicleType);
  logger.info({ newRideId, nearbyCount: nearbyDrivers.length }, 'SOS rebook: new ride broadcasting');

  if (nearbyDrivers.length > 0) {
    const driverIds = nearbyDrivers.map((d) => d.id);
    const drivers = await prisma.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, vendorId: true },
    });
    const vendorIds = [...new Set(drivers.map((d) => d.vendorId))];

    const ridePayload = {
      id: newRideId, type: ride_type, status: 'broadcasting',
      pickup_address: pickupAddress, drop_address: drop_address,
      pax_count: paxCount, capacity, distance_km: estimatedKm, price,
    };

    for (const vid of vendorIds) {
      io.of('/driver').to(`vendor:${vid}`).emit('ride:broadcast', ridePayload);
    }

    await prisma.rideOffer.createMany({
      data: driverIds.map((driverId) => ({ rideId: newRideId, driverId, response: 'pending' })),
      skipDuplicates: true,
    });
  }

  // ── 12. Notify supervisor and admin ──────────────────────────────────────
  io.of('/supervisor')
    .to(`supervisor:${supervisorId}`)
    .emit('sos:rebook_complete', {
      issueId,
      originalRideId: rideId,
      newRideId,
      nearbyCount: nearbyDrivers.length,
      employeeCount: paxCount,
      boardedCount: boarded.length,
      pickupAddress,
      estimatedKm,
      price,
    });

  io.of('/admin').to('admin').emit('admin:activity', {
    event: 'sos:rebook',
    originalRideId: rideId,
    newRideId,
    issueId,
  });

  return {
    newRideId,
    newRideStatus: 'broadcasting',
    nearbyCount: nearbyDrivers.length,
    employeeCount: paxCount,
    boardedCount: boarded.length,
  };
}
