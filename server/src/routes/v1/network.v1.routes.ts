import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { SyncState } from '../../models/SyncState';
import { getChainTip } from '../../services/chainTip.service';
import { governanceService } from '../../services/governance.service';
import { rpcService } from '../../services/rpc.service';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { firstValidationIssueMessage, sendInternalError, sendServiceUnavailable, sendValidationError } from '../../utils/validation';

const router = Router();

type RpcMempoolInfo = { size?: number };
type RpcNetworkInfo = { connections?: number };

const governanceObjectsQuerySchema = z.object({
  signal: z.enum(['all', 'valid', 'funding', 'delete', 'endorsed']).optional(),
  objectType: z.enum(['all', 'proposals', 'triggers']).optional(),
  limit: z.preprocess(
    (value) => (value == null || value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(500).optional()
  ),
  includeRaw: z.preprocess(
    (value) => (value == null || value === '' ? undefined : value),
    z.coerce.boolean().optional()
  ),
});

type NetworkHealthPayload = { success: true; data: Record<string, unknown> };
type NetworkHealthCacheEntry = { atMs: number; payload: NetworkHealthPayload };

const NETWORK_HEALTH_TTL_MS = 15_000;
const NETWORK_HEALTH_STALE_MAX_MS = 90_000;

let networkHealthCache: NetworkHealthCacheEntry | null = null;
let networkHealthInFlight: Promise<NetworkHealthCacheEntry> | null = null;

function isFresh(cachedAtMs: number, ttlMs: number): boolean {
  return Date.now() - cachedAtMs < ttlMs;
}

async function fetchNetworkHealthEntry(): Promise<NetworkHealthCacheEntry> {
  const warnings: string[] = [];
  const [tip, syncState, daemonHeightResult, difficultyResult, hashrateResult, networkResult, mempoolResult] =
    await Promise.allSettled([
      getChainTip(),
      SyncState.findOne({ key: 'main' }).lean(),
      rpcService.getBlockCount(),
      rpcService.getDifficulty(),
      rpcService.getNetworkHashPS(),
      rpcService.getNetworkInfo() as Promise<RpcNetworkInfo>,
      rpcService.getMempoolInfo() as Promise<RpcMempoolInfo>,
    ]);

  const block = tip.status === 'fulfilled' ? tip.value : null;
  const sync = syncState.status === 'fulfilled' ? syncState.value : null;

  const blockHeight = block?.height ?? null;
  const lastBlockAgeSec = typeof block?.time === 'number' ? Math.floor(Date.now() / 1000) - block.time : null;
  const daemonHeight = daemonHeightResult.status === 'fulfilled' ? daemonHeightResult.value : null;
  if (daemonHeightResult.status !== 'fulfilled') {
    warnings.push('daemonHeight');
  }

  let difficulty: number | null = null;
  if (difficultyResult.status === 'fulfilled') {
    difficulty = difficultyResult.value;
  } else {
    warnings.push('difficulty');
  }

  let hashrate: number | null = null;
  if (hashrateResult.status === 'fulfilled') {
    hashrate = hashrateResult.value;
  } else {
    warnings.push('hashrate');
  }

  let peerCount: number | null = null;
  if (networkResult.status === 'fulfilled') {
    peerCount = networkResult.value?.connections ?? null;
  } else {
    warnings.push('peerCount');
  }

  let mempoolSize: number | null = null;
  if (mempoolResult.status === 'fulfilled') {
    mempoolSize = mempoolResult.value?.size ?? null;
  } else {
    warnings.push('mempoolSize');
  }

  const syncedHeight = typeof sync?.lastSyncedHeight === 'number' ? sync.lastSyncedHeight : blockHeight;
  const syncProgress =
    daemonHeight != null && daemonHeight > 0 && syncedHeight != null && syncedHeight >= 0
      ? Math.min(1, syncedHeight / daemonHeight)
      : null;

  const data: Record<string, unknown> = {
    blockHeight,
    daemonHeight,
    lastBlockAgeSec,
    difficulty,
    hashrate,
    peerCount,
    mempoolSize,
    syncProgress: syncProgress != null ? Math.round(syncProgress * 10000) / 10000 : null,
  };

  if (warnings.length > 0) {
    data.warnings = warnings.map((field) => `${field} unavailable (daemon RPC error)`);
  }

  const payload: NetworkHealthPayload = { success: true, data };
  const entry = { atMs: Date.now(), payload };
  networkHealthCache = entry;
  return entry;
}

router.get('/health', withCachePolicy('short'), async (_req: Request, res: Response) => {
  try {
    if (networkHealthCache && isFresh(networkHealthCache.atMs, NETWORK_HEALTH_TTL_MS)) {
      return res.json(networkHealthCache.payload);
    }

    const staleFallbackAllowed =
      !!networkHealthCache && isFresh(networkHealthCache.atMs, NETWORK_HEALTH_STALE_MAX_MS);

    if (networkHealthInFlight) {
      try {
        const deduped = await networkHealthInFlight;
        return res.json(deduped.payload);
      } catch {
        if (staleFallbackAllowed && networkHealthCache) {
          return res.json(networkHealthCache.payload);
        }
        throw new Error('Network health in-flight query failed');
      }
    }

    const fetchPromise = fetchNetworkHealthEntry();
    networkHealthInFlight = fetchPromise;
    try {
      const fresh = await fetchPromise;
      return res.json(fresh.payload);
    } catch (error) {
      if (staleFallbackAllowed && networkHealthCache) {
        return res.json(networkHealthCache.payload);
      }
      throw error;
    } finally {
      if (networkHealthInFlight === fetchPromise) {
        networkHealthInFlight = null;
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch network health', error);
  }
});

router.get('/sporks', withCachePolicy('short'), async (_req: Request, res: Response) => {
  try {
    const data = await governanceService.fetchSporkSnapshot();
    const hasAnyCapability =
      data.capabilities.sporkShow || data.capabilities.sporkActive || data.capabilities.governanceInfo;

    if (!hasAnyCapability) {
      return sendServiceUnavailable(res, 'Governance RPC methods are not available on this daemon');
    }

    return res.json({ success: true, data });
  } catch (error) {
    return sendServiceUnavailable(res, 'Failed to fetch spork/governance snapshot', error);
  }
});

router.get('/governance/objects', withCachePolicy('short'), async (req: Request, res: Response) => {
  const parsed = governanceObjectsQuerySchema.safeParse({
    signal: req.query.signal,
    objectType: req.query.objectType,
    limit: req.query.limit,
    includeRaw: req.query.includeRaw,
  });
  if (!parsed.success) {
    return sendValidationError(res, firstValidationIssueMessage(parsed.error));
  }

  try {
    const data = await governanceService.fetchGovernanceObjects({
      signal: parsed.data.signal ?? 'valid',
      objectType: parsed.data.objectType ?? 'all',
      limit: parsed.data.limit ?? 100,
      includeRaw: parsed.data.includeRaw ?? false,
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendServiceUnavailable(res, 'Failed to fetch governance objects', error);
  }
});

export default router;
