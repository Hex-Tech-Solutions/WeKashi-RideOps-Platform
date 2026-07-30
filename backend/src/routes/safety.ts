import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { parsePagination } from '../lib/pagination';
import { createIncident, listIncidents, updateIncidentStatus } from '../services/safety.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import type { AuthRequest } from '../types';

const router = Router();

const CreateIncidentSchema = z.object({
  rideId: z.string().uuid(),
  description: z.string().min(10).max(1000),
});

const UpdateIncidentSchema = z.object({
  status: z.enum(['open', 'investigating', 'resolved', 'closed']),
});

router.use(authenticate);

// GET /safety/incidents
router.get('/incidents', requireRole('admin', 'supervisor'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = parsePagination(req.query.page, req.query.limit);
    const status = req.query.status as string | undefined;
    const rideId = req.query.rideId as string | undefined;

    const result = await listIncidents({ rideId, status, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /safety/incidents — driver (assigned to ride) or supervisor (owns the ride)
router.post('/incidents', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = CreateIncidentSchema.parse(req.body);
    const reportedBy = req.user?.id ?? req.driver?.id ?? '';

    if (!reportedBy) {
      res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }

    // Validate reporter is related to the ride — prevents arbitrary incident creation
    const { prisma } = await import('../lib/prisma');
    const ride = await prisma.ride.findUnique({
      where: { id: body.rideId },
      select: { driverId: true, supervisorId: true },
    });
    if (!ride) {
      res.status(404).json({ error: 'Ride not found', code: 'NOT_FOUND' });
      return;
    }
    const isDriver     = req.driver && ride.driverId === req.driver.id;
    const isSupervisor = req.user?.role === 'supervisor' && ride.supervisorId === req.user.id;
    const isAdmin      = req.user?.role === 'admin';
    if (!isDriver && !isSupervisor && !isAdmin) {
      res.status(403).json({ error: 'Forbidden — not related to this ride', code: 'FORBIDDEN' });
      return;
    }

    const incident = await createIncident({ ...body, reportedBy });
    res.status(201).json(incident);
  } catch (err) {
    next(err);
  }
});

// PATCH /safety/incidents/:id
router.patch('/incidents/:id', requireRole('admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = UpdateIncidentSchema.parse(req.body);
    const incident = await updateIncidentStatus(req.params.id, status);
    res.json(incident);
  } catch (err) {
    next(err);
  }
});

export default router;
