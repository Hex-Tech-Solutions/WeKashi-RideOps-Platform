import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import {
  createEmployee,
  bulkCreateEmployees,
  listEmployees,
  getEmployee,
  updateEmployee,
  deleteEmployee,
} from '../services/employee.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { NotFoundError, ForbiddenError } from '../types';
import type { AuthRequest } from '../types';

const router = Router();

const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const EmployeeSchema = z.object({
  empId: z.string().min(1).max(50),
  name: z.string().min(2).max(100),
  gender: z.enum(['male', 'female', 'other']),
  phone: z.string().min(10).max(15).optional(),
  pickupLocation: GeoPointSchema,
  dropLocation: GeoPointSchema,
  pickupAddress: z.string().min(1),
  dropAddress: z.string().min(1),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
  shiftEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM'),
  companyLabel: z.string().max(100).optional(),
});

const UpdateEmployeeSchema = EmployeeSchema.partial();

router.use(authenticate);
router.use(requireRole('supervisor'));

// GET /employees
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit, 50);
    const result = await listEmployees(req.user!.id, page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /employees
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = EmployeeSchema.parse(req.body);
    const employee = await createEmployee({ ...body, supervisorId: req.user!.id });
    res.status(201).json(employee);
  } catch (err) {
    next(err);
  }
});

// POST /employees/bulk — CSV import (array)
router.post('/bulk', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = z.array(EmployeeSchema).min(1).max(500).parse(req.body);
    const results = await bulkCreateEmployees(req.user!.id, body);
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    res.status(207).json({ results, successCount, failCount });
  } catch (err) {
    next(err);
  }
});

// GET /employees/:id
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const employee = await getEmployee(req.params.id);
    if (!employee) throw new NotFoundError('Employee not found');
    if (employee.supervisorId !== req.user!.id) throw new ForbiddenError('Access denied');
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

// PATCH /employees/:id
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = UpdateEmployeeSchema.parse(req.body);
    const employee = await updateEmployee(req.params.id, req.user!.id, body);
    res.json(employee);
  } catch (err) {
    next(err);
  }
});

// DELETE /employees/:id
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await deleteEmployee(req.params.id, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
