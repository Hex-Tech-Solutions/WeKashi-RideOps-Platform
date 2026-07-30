import { prisma } from '../lib/prisma';
import { NotFoundError, ForbiddenError } from '../types';

export interface CreateEmployeeInput {
  supervisorId: string;
  empId: string;
  name: string;
  gender: string;
  phone?: string;
  pickupLocation: { lat: number; lng: number };
  dropLocation: { lat: number; lng: number };
  pickupAddress: string;
  dropAddress: string;
  shiftStart: string;
  shiftEnd: string;
  companyLabel?: string;
}

export async function createEmployee(input: CreateEmployeeInput) {
  const result = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO employees (
      id, supervisor_id, emp_id, name, gender, phone,
      pickup_location, drop_location,
      pickup_address, drop_address,
      shift_start, shift_end, company_label, created_at
    ) VALUES (
      gen_random_uuid(),
      ${input.supervisorId},
      ${input.empId},
      ${input.name},
      ${input.gender},
      ${input.phone ?? null},
      ST_SetSRID(ST_MakePoint(${input.pickupLocation.lng}, ${input.pickupLocation.lat}), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${input.dropLocation.lng}, ${input.dropLocation.lat}), 4326)::geography,
      ${input.pickupAddress},
      ${input.dropAddress},
      ${input.shiftStart},
      ${input.shiftEnd},
      ${input.companyLabel ?? null},
      NOW()
    )
    RETURNING id
  `;
  return getEmployee(result[0].id);
}

export async function bulkCreateEmployees(
  supervisorId: string,
  employees: Omit<CreateEmployeeInput, 'supervisorId'>[],
) {
  const results = [];
  for (const emp of employees) {
    try {
      const created = await createEmployee({ ...emp, supervisorId });
      results.push({ success: true, empId: emp.empId, id: created?.id });
    } catch (err) {
      results.push({
        success: false,
        empId: emp.empId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }
  return results;
}

export async function listEmployees(supervisorId: string, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  const [rows, total] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: string; emp_id: string; name: string; gender: string; phone: string | null;
      pickup_address: string; drop_address: string; shift_start: string; shift_end: string;
      company_label: string | null; created_at: Date;
      pickup_lat: number; pickup_lng: number; drop_lat: number; drop_lng: number;
    }>>`
      SELECT id, emp_id, name, gender, phone, pickup_address, drop_address,
             shift_start, shift_end, company_label, created_at,
        ST_Y(pickup_location::geometry) as pickup_lat, ST_X(pickup_location::geometry) as pickup_lng,
        ST_Y(drop_location::geometry)   as drop_lat,   ST_X(drop_location::geometry)   as drop_lng
      FROM employees WHERE supervisor_id = ${supervisorId}
      ORDER BY created_at DESC OFFSET ${skip} LIMIT ${limit}
    `,
    prisma.employee.count({ where: { supervisorId } }),
  ]);
  const employees = rows.map((r) => ({
    id: r.id, empId: r.emp_id, name: r.name, gender: r.gender, phone: r.phone,
    pickupAddress: r.pickup_address, dropAddress: r.drop_address,
    shiftStart: r.shift_start, shiftEnd: r.shift_end,
    companyLabel: r.company_label,
    createdAt: r.created_at,
    pickupLat: r.pickup_lat, pickupLng: r.pickup_lng, dropLat: r.drop_lat, dropLng: r.drop_lng,
  }));
  return { employees, total, page, limit };
}

export async function getEmployee(id: string) {
  return prisma.employee.findUnique({ where: { id } });
}

export async function updateEmployee(
  id: string,
  supervisorId: string,
  data: Partial<CreateEmployeeInput>,
) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError('Employee not found');
  if (employee.supervisorId !== supervisorId) {
    throw new ForbiddenError('You can only update your own employees');
  }

  // Handle geo updates separately
  if (data.pickupLocation || data.dropLocation) {
    const pickup = data.pickupLocation ?? {
      lat: 0, lng: 0, // will be ignored if not provided
    };
    const drop = data.dropLocation ?? { lat: 0, lng: 0 };

    if (data.pickupLocation && data.dropLocation) {
      await prisma.$executeRaw`
        UPDATE employees
        SET
          pickup_location = ST_SetSRID(ST_MakePoint(${pickup.lng}, ${pickup.lat}), 4326)::geography,
          drop_location = ST_SetSRID(ST_MakePoint(${drop.lng}, ${drop.lat}), 4326)::geography,
          pickup_address = ${data.pickupAddress ?? employee.pickupAddress},
          drop_address = ${data.dropAddress ?? employee.dropAddress}
        WHERE id = ${id}
      `;
    } else if (data.pickupLocation) {
      await prisma.$executeRaw`
        UPDATE employees
        SET
          pickup_location = ST_SetSRID(ST_MakePoint(${pickup.lng}, ${pickup.lat}), 4326)::geography,
          pickup_address = ${data.pickupAddress ?? employee.pickupAddress}
        WHERE id = ${id}
      `;
    } else if (data.dropLocation) {
      await prisma.$executeRaw`
        UPDATE employees
        SET
          drop_location = ST_SetSRID(ST_MakePoint(${drop.lng}, ${drop.lat}), 4326)::geography,
          drop_address = ${data.dropAddress ?? employee.dropAddress}
        WHERE id = ${id}
      `;
    }
  }

  // Update scalar fields
  const scalarUpdate: Record<string, unknown> = {};
  if (data.name !== undefined) scalarUpdate.name = data.name;
  if (data.gender !== undefined) scalarUpdate.gender = data.gender;
  if (data.phone !== undefined) scalarUpdate.phone = data.phone;
  if (data.shiftStart !== undefined) scalarUpdate.shiftStart = data.shiftStart;
  if (data.shiftEnd !== undefined) scalarUpdate.shiftEnd = data.shiftEnd;
  if (data.companyLabel !== undefined) scalarUpdate.companyLabel = data.companyLabel || null;

  if (Object.keys(scalarUpdate).length > 0) {
    await prisma.employee.update({ where: { id }, data: scalarUpdate });
  }

  return prisma.employee.findUnique({ where: { id } });
}

export async function deleteEmployee(id: string, supervisorId: string) {
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) throw new NotFoundError('Employee not found');
  if (employee.supervisorId !== supervisorId) {
    throw new ForbiddenError('You can only delete your own employees');
  }
  await prisma.employee.delete({ where: { id } });
}
