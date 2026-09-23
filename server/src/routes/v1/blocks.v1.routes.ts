import { Router, Request, Response } from 'express';
import { COIN } from '@defcon/shared';
import { Block } from '../../models/Block';
import { config } from '../../config';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { normalizeBlockAmounts, satToCoin, type SatLike } from '../../utils/amounts';
import {
  firstValidationIssueMessage,
  parseV1LatestCount,
  sendInternalError,
  sendValidationError,
} from '../../utils/validation';

const router = Router();
const V1_LATEST_BLOCKS_TTL_MS = Math.max(1000, Math.min(10_000, config.cache.ttlSeconds * 1000));
const V1_LATEST_BLOCKS_STALE_MAX_MS = Math.max(V1_LATEST_BLOCKS_TTL_MS * 4, 60_000);
const V1_LATEST_BLOCKS_CACHE_LIMIT = 32;
type V1LatestBlocksPayload = {
  success: true;
  data: Array<Record<string, unknown>>;
  meta: { rewardSplitSource: 'derived' };
};
const latestV1BlocksCache = new Map<number, { atMs: number; payload: V1LatestBlocksPayload }>();
const latestV1BlocksInFlight = new Map<number, Promise<V1LatestBlocksPayload>>();

const BLOCK_PROJECTION = {
  hash: 1,
  height: 1,
  time: 1,
  nTx: 1,
  difficulty: 1,
  totalValueOutSat: 1,
  minedBy: 1,
  rewardSat: 1,
  size: 1,
};

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function addRewardSplit<T extends Record<string, unknown>>(
  block: T
): T & { rewardSplit: Record<string, number> } {
  const reward = satToCoin(block.rewardSat as SatLike);
  const mn = Math.min(reward, COIN.INITIAL_REWARD);
  const stake = Math.max(0, reward - mn);

  return {
    ...block,
    rewardSplit: {
      total: reward,
      mn: round8(mn),
      stake: round8(stake),
    },
  };
}

function getLatestBlocksCache(count: number): V1LatestBlocksPayload | null {
  const entry = latestV1BlocksCache.get(count);
  if (!entry) return null;
  if (Date.now() - entry.atMs >= V1_LATEST_BLOCKS_TTL_MS) {
    latestV1BlocksCache.delete(count);
    return null;
  }
  latestV1BlocksCache.delete(count);
  latestV1BlocksCache.set(count, entry);
  return entry.payload;
}

function getLatestBlocksStaleCache(count: number): V1LatestBlocksPayload | null {
  const entry = latestV1BlocksCache.get(count);
  if (!entry) return null;
  if (Date.now() - entry.atMs >= V1_LATEST_BLOCKS_STALE_MAX_MS) {
    latestV1BlocksCache.delete(count);
    return null;
  }
  return entry.payload;
}

function setLatestBlocksCache(count: number, payload: V1LatestBlocksPayload): void {
  if (latestV1BlocksCache.has(count)) latestV1BlocksCache.delete(count);
  while (latestV1BlocksCache.size >= V1_LATEST_BLOCKS_CACHE_LIMIT) {
    const oldestKey = latestV1BlocksCache.keys().next().value;
    if (oldestKey === undefined) break;
    latestV1BlocksCache.delete(oldestKey);
  }
  latestV1BlocksCache.set(count, { atMs: Date.now(), payload });
}

router.get('/latest', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const countParsed = parseV1LatestCount(req.query as Record<string, unknown>, 10);
    if (!countParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(countParsed.error));
    }
    const { count } = countParsed.data;
    const cached = getLatestBlocksCache(count);
    if (cached) {
      return res.json(cached);
    }
    const staleCached = getLatestBlocksStaleCache(count);

    const inFlight = latestV1BlocksInFlight.get(count);
    if (inFlight) {
      try {
        const deduped = await inFlight;
        return res.json(deduped);
      } catch {
        if (staleCached) {
          return res.json(staleCached);
        }
        throw new Error('V1 latest blocks in-flight query failed');
      }
    }

    const fetchPromise = (async () => {
      const blocks = await Block.find()
        .sort({ height: -1 })
        .limit(count)
        .select(BLOCK_PROJECTION)
        .lean();

      const data = blocks.map((block) => addRewardSplit(normalizeBlockAmounts(block)));
      const payload: V1LatestBlocksPayload = {
        success: true,
        data,
        meta: {
          rewardSplitSource: 'derived',
        },
      };
      setLatestBlocksCache(count, payload);
      return payload;
    })();

    latestV1BlocksInFlight.set(count, fetchPromise);
    try {
      const payload = await fetchPromise;
      return res.json(payload);
    } catch (error) {
      if (staleCached) {
        return res.json(staleCached);
      }
      throw error;
    } finally {
      if (latestV1BlocksInFlight.get(count) === fetchPromise) {
        latestV1BlocksInFlight.delete(count);
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch latest blocks', error);
  }
});

export default router;
