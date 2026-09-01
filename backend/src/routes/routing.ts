import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { optimizeRouteOrder } from '../services/routeOptimize.service';
import { computeRouteMatrix } from '../lib/routesApi';
import { ValidationError } from '../types';
import type { AuthRequest } from '../types';

const router = Router();
router.use(authenticate);

const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const OptimizeRouteSchema = z.object({
  type: z.enum(['login', 'logout']),
  office: GeoPointSchema,
  stops: z.array(z.object({
    empId: z.string().uuid(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })).min(1).max(20),
  /** false = keep stops in the exact order given (e.g. after a manual drag/reorder or pin move); just compute real distance/duration. Defaults to true (let Google order for efficiency). */
  optimize: z.boolean().optional(),
});

// POST /routing/optimize — supervisor only.
// Orders the given stops for efficiency using Google Routes API (real driving
// distance/duration, not straight-line). Returns the optimized sequence plus
// total distance/ETA/polyline for the FINAL order.
//
// NOTE: no gender/safety logic runs here — this is pure route efficiency.
// The escort/women's-safety check happens separately in POST /rides, against
// whichever order is ultimately submitted (this one, or the supervisor's
// manual drag/arrow edit of it).
router.post('/optimize', requireRole('supervisor'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = OptimizeRouteSchema.parse(req.body);
    const result = await optimizeRouteOrder(body.stops, body.office, body.type, body.optimize ?? true);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const ComputeRouteSchema = z.object({
  origin: GeoPointSchema,
  destination: GeoPointSchema,
  /** Intermediate stops, IN ORDER — never reordered. */
  intermediates: z.array(GeoPointSchema).max(23).optional(),
});

// POST /routing/route — any authenticated role.
// Real driving distance + traffic-aware duration for a FIXED sequence of
// stops (origin -> intermediates in the given order -> destination), with
// a per-leg breakdown. Used for live ride tracking (driver's current GPS ->
// remaining stops -> office) where the order is already decided by the pax
// sequence and must not be re-optimized.
router.post('/route', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = ComputeRouteSchema.parse(req.body);
    const { computeRoute } = await import('../lib/routesApi');
    const result = await computeRoute({
      origin: { location: body.origin },
      destination: { location: body.destination },
      intermediates: body.intermediates?.map((p) => ({ location: p })),
      optimizeWaypointOrder: false,
    });
    res.json({
      distanceMeters: result.distanceMeters,
      durationSeconds: result.durationSeconds,
      encodedPolyline: result.encodedPolyline,
      legs: result.legs,
    });
  } catch (err) {
    next(err);
  }
});

const MatrixSchema = z.object({
  origins: z.array(GeoPointSchema).min(1).max(25),
  destinations: z.array(GeoPointSchema).min(1).max(25),
});

// POST /routing/matrix — any authenticated role.
// Real driving distance + traffic-aware duration for every (origin,
// destination) pair. Used for things like "driver's distance from the next
// pickup stop" instead of a flat Haversine + assumed-speed guess.
router.post('/matrix', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = MatrixSchema.parse(req.body);
    if (body.origins.length * body.destinations.length > 625) {
      throw new ValidationError('Too many origin/destination combinations (max 625)');
    }
    const elements = await computeRouteMatrix(body.origins, body.destinations);
    res.json({ elements });
  } catch (err) {
    next(err);
  }
});

export default router;
