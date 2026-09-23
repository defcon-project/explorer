import { Router, Request, Response } from 'express';
import { statsApiResponseSchema, type StatsApiResponse } from '@defcon/shared/dist/contracts';
import { getStatsData } from '../services/stats.service';
import { withCachePolicy } from '../middleware/cachePolicy';
import { config } from '../config';
import { sendInternalError } from '../utils/validation';

const router = Router();
const STATS_TTL_MS = Math.max(3000, Math.min(15_000, config.cache.ttlSeconds * 1000));
const STATS_STALE_MAX_MS = Math.max(STATS_TTL_MS * 4, 60_000);

let statsCache: { atMs: number; payload: StatsApiResponse } | null = null;
let statsInFlight: Promise<StatsApiResponse> | null = null;

export async function getStatsPayload(): Promise<StatsApiResponse> {
  if (statsCache && Date.now() - statsCache.atMs < STATS_TTL_MS) {
    return statsCache.payload;
  }

  const staleFallbackAllowed = !!statsCache && Date.now() - statsCache.atMs < STATS_STALE_MAX_MS;

  if (!statsInFlight) {
    statsInFlight = (async () => statsApiResponseSchema.parse({ success: true, data: await getStatsData() }))();
  }

  const activeInFlight = statsInFlight;
  try {
    const payload = await activeInFlight;
    statsCache = { atMs: Date.now(), payload };
    return payload;
  } catch (error) {
    if (staleFallbackAllowed && statsCache) {
      return statsCache.payload;
    }
    throw error;
  } finally {
    if (statsInFlight === activeInFlight) {
      statsInFlight = null;
    }
  }
}

router.get('/', withCachePolicy('short'), async (_req: Request, res: Response) => {
  try {
    return res.json(await getStatsPayload());
  } catch (error) {
    return sendInternalError(res, 'Failed to fetch stats', error);
  }
});

export default router;
