import { Router, Response, NextFunction } from 'express';
import { getOverview, getRideAnalytics, getVendorPerformance } from '../services/analytics.service';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import type { AuthRequest } from '../types';

const router = Router();

router.use(authenticate);
router.use(requireRole('admin'));

// GET /analytics/overview
router.get('/overview', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await getOverview();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /analytics/rides
router.get('/rides', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const period = req.query.period as string | undefined;
    const data = await getRideAnalytics(period);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /analytics/vendors/:id/performance
router.get('/vendors/:id/performance', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await getVendorPerformance(req.params.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
