import { Router, Request, Response } from 'express';
import { COIN } from '@defcon/shared';
import { withCachePolicy } from '../middleware/cachePolicy';

const router = Router();

// GET /api/coin - Static chain parameters
router.get('/', withCachePolicy('long'), async (_req: Request, res: Response) => {
  res.json({ success: true, data: COIN });
});

export default router;
