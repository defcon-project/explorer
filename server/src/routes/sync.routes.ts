import { Router, Request, Response } from 'express';
import { SyncState } from '../models/SyncState';
import { Block } from '../models/Block';
import { Transaction } from '../models/Transaction';
import { Address } from '../models/Address';
import { rpcService } from '../services/rpc.service';
import { config } from '../config';
import { withCachePolicy } from '../middleware/cachePolicy';
import { sendInternalError } from '../utils/validation';
import { mapPublicSyncError } from '../utils/publicSyncError';

const router = Router();
const DB_STATS_TTL_MS = 30_000;
const SYNC_STATUS_TTL_MS = Math.max(1000, Math.min(5000, config.cache.ttlSeconds * 1000));
const SYNC_STATUS_STALE_MAX_MS = Math.max(SYNC_STATUS_TTL_MS * 6, 60_000);

type DbStatsSnapshot = {
  blocks: number;
  transactions: number;
  addresses: number;
};

let dbStatsCache: { atMs: number; data: DbStatsSnapshot } | null = null;
let dbStatsInFlight: Promise<DbStatsSnapshot> | null = null;
let syncStatusCache: { atMs: number; payload: { success: true; data: Record<string, unknown> } } | null = null;
let syncStatusInFlight: Promise<{ success: true; data: Record<string, unknown> }> | null = null;

async function getDbStatsSnapshot(): Promise<DbStatsSnapshot> {
  const now = Date.now();
  if (dbStatsCache && now - dbStatsCache.atMs < DB_STATS_TTL_MS) {
    return dbStatsCache.data;
  }
  if (dbStatsInFlight) {
    return dbStatsInFlight;
  }

  dbStatsInFlight = Promise.all([
    Block.estimatedDocumentCount(),
    Transaction.estimatedDocumentCount(),
    Address.estimatedDocumentCount(),
  ])
    .then(([blocks, transactions, addresses]) => {
      const data = { blocks, transactions, addresses };
      dbStatsCache = { atMs: Date.now(), data };
      return data;
    })
    .finally(() => {
      dbStatsInFlight = null;
    });
  return dbStatsInFlight;
}

// GET /api/sync - Sync status overview
router.get('/', withCachePolicy('short'), async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (syncStatusCache && now - syncStatusCache.atMs < SYNC_STATUS_TTL_MS) {
      return res.json(syncStatusCache.payload);
    }
    const staleFallbackAllowed = !!syncStatusCache && now - syncStatusCache.atMs < SYNC_STATUS_STALE_MAX_MS;
    if (syncStatusInFlight) {
      try {
        const deduped = await syncStatusInFlight;
        return res.json(deduped);
      } catch {
        if (staleFallbackAllowed && syncStatusCache) {
          return res.json(syncStatusCache.payload);
        }
        throw new Error('Sync status in-flight query failed');
      }
    }

    const fetchPromise = (async () => {
      const syncState = await SyncState.findOne({ key: 'main' }).lean();
      let daemonHeight = -1;
      let rpcConnected = true;

      try {
        daemonHeight = await rpcService.getBlockCount();
      } catch {
        // Daemon unreachable
        rpcConnected = false;
      }

      const lastSyncedHeight = syncState?.lastSyncedHeight ?? -1;
      const blocksRemaining = daemonHeight >= 0 ? Math.max(0, daemonHeight - lastSyncedHeight) : 0;
      const rawProgress = daemonHeight > 0 ? ((lastSyncedHeight + 1) / (daemonHeight + 1)) * 100 : 0;
      const progress = Math.max(0, Math.min(100, rawProgress));
      // Warm/cache db counts, but do not expose them publicly on this endpoint.
      // Detailed sync internals belong to admin-only routes.
      await getDbStatsSnapshot();
      const publicError = mapPublicSyncError(syncState?.error, rpcConnected);

      const payload = {
        success: true as const,
        data: {
          isRunning: syncState?.isRunning ?? false,
          lastSyncedHeight,
          daemonHeight,
          rpcConnected,
          blocksRemaining,
          progress: Math.round(progress * 100) / 100,
          error: publicError.error,
          errorCode: publicError.errorCode,
        },
      };
      syncStatusCache = { atMs: Date.now(), payload };
      return payload;
    })();

    syncStatusInFlight = fetchPromise;
    try {
      const payload = await fetchPromise;
      return res.json(payload);
    } catch (error) {
      if (staleFallbackAllowed && syncStatusCache) {
        return res.json(syncStatusCache.payload);
      }
      throw error;
    } finally {
      if (syncStatusInFlight === fetchPromise) {
        syncStatusInFlight = null;
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch sync status', error);
  }
});

export default router;
