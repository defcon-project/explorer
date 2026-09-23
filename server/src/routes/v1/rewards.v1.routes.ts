import { Router, Request, Response } from 'express';
import { COIN } from '@defcon/shared';
import { Block } from '../../models/Block';
import { config } from '../../config';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { satToCoin, type SatLike } from '../../utils/amounts';
import { sendInternalError } from '../../utils/validation';

const router = Router();
const CURRENT_REWARDS_TTL_MS = Math.max(2_000, Math.min(20_000, config.cache.ttlSeconds * 2_000));
const CURRENT_REWARDS_STALE_MAX_MS = Math.max(CURRENT_REWARDS_TTL_MS * 4, 60_000);
type CurrentRewardsPayload = {
  success: true;
  data: {
    blockRewardTotal: number;
    mnReward: number | null;
    stakeReward: number | null;
    source: 'derived';
  };
};
let currentRewardsCache: { atMs: number; payload: CurrentRewardsPayload } | null = null;
let currentRewardsInFlight: Promise<CurrentRewardsPayload> | null = null;

function isFresh(atMs: number, ttlMs: number): boolean {
  return Date.now() - atMs < ttlMs;
}

router.get('/current', withCachePolicy('short'), async (_req: Request, res: Response) => {
  try {
    if (currentRewardsCache && isFresh(currentRewardsCache.atMs, CURRENT_REWARDS_TTL_MS)) {
      return res.json(currentRewardsCache.payload);
    }

    const staleFallbackAllowed =
      !!currentRewardsCache && isFresh(currentRewardsCache.atMs, CURRENT_REWARDS_STALE_MAX_MS);

    if (currentRewardsInFlight) {
      try {
        const deduped = await currentRewardsInFlight;
        return res.json(deduped);
      } catch {
        if (staleFallbackAllowed && currentRewardsCache) {
          return res.json(currentRewardsCache.payload);
        }
        throw new Error('Current rewards in-flight query failed');
      }
    }

    const fetchPromise = (async (): Promise<CurrentRewardsPayload> => {
      const latestBlock = await Block.findOne()
        .sort({ height: -1 })
        .select({ rewardSat: 1 })
        .lean<{ rewardSat?: SatLike }>();

      const blockRewardTotal = satToCoin(latestBlock?.rewardSat);

      let mnReward: number | null = null;
      let stakeReward: number | null = null;

      if (blockRewardTotal > 0) {
        const baseMasternodeReward = COIN.INITIAL_REWARD;
        mnReward = Math.min(blockRewardTotal, baseMasternodeReward);
        stakeReward = Math.max(0, blockRewardTotal - mnReward);
      }

      const payload: CurrentRewardsPayload = {
        success: true,
        data: { blockRewardTotal, mnReward, stakeReward, source: 'derived' },
      };
      currentRewardsCache = { atMs: Date.now(), payload };
      return payload;
    })();

    currentRewardsInFlight = fetchPromise;
    try {
      const payload = await fetchPromise;
      return res.json(payload);
    } catch (error) {
      if (staleFallbackAllowed && currentRewardsCache) {
        return res.json(currentRewardsCache.payload);
      }
      throw error;
    } finally {
      if (currentRewardsInFlight === fetchPromise) {
        currentRewardsInFlight = null;
      }
    }

  } catch (error) {
    sendInternalError(res, 'Failed to fetch current rewards', error);
  }
});

export default router;
