import { Router, Request, Response } from 'express';
import { config } from '../config';
import { withCachePolicy } from '../middleware/cachePolicy';
import { rpcService } from '../services/rpc.service';
import { logger } from '../utils/logger';
import {
  firstValidationIssueMessage,
  parseMempoolLimitQuery,
  sendServiceUnavailable,
  sendValidationError,
} from '../utils/validation';

const router = Router();
const MEMPOOL_TTL_MS = Math.max(1000, Math.min(5000, config.cache.ttlSeconds * 1000));
const MEMPOOL_STALE_MAX_MS = Math.max(MEMPOOL_TTL_MS * 4, 20_000);
const MEMPOOL_SNAPSHOT_TTL_MS = Math.max(MEMPOOL_TTL_MS * 3, 20_000);
const MEMPOOL_CONCURRENCY = 4;
const MEMPOOL_RAW_TX_SAMPLE_LIMIT = 8;
const mempoolCache = new Map<number, { atMs: number; payload: { success: true; data: Record<string, unknown> } }>();
const mempoolInFlight = new Map<number, Promise<{ success: true; data: Record<string, unknown> }>>();
let mempoolSnapshotCache: { atMs: number; info: RpcMempoolInfo; txids: string[] } | null = null;
let mempoolSnapshotInFlight: Promise<{ info: RpcMempoolInfo; txids: string[] }> | null = null;

type RpcMempoolInfo = {
  size?: number;
  bytes?: number;
  usage?: number;
  maxmempool?: number;
  mempoolminfee?: number;
  minrelaytxfee?: number;
};

type RpcMempoolEntry = {
  fees?: {
    base?: number;
    modified?: number;
  };
  fee?: number;
  vsize?: number;
  size?: number;
  time?: number;
};

type RpcRawTx = {
  fee?: number;
  size?: number;
  time?: number;
  vout?: Array<{ value?: number }>;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getMempoolSnapshot(): Promise<{ info: RpcMempoolInfo; txids: string[] }> {
  const now = Date.now();
  if (mempoolSnapshotCache && now - mempoolSnapshotCache.atMs < MEMPOOL_SNAPSHOT_TTL_MS) {
    return { info: mempoolSnapshotCache.info, txids: mempoolSnapshotCache.txids };
  }

  if (mempoolSnapshotInFlight) {
    return mempoolSnapshotInFlight;
  }

  const fetchPromise = (async () => {
    const [info, allTxids] = await Promise.all([
      rpcService.getMempoolInfo() as Promise<RpcMempoolInfo>,
      rpcService.getRawMemPool(),
    ]);

    const txids = allTxids || [];
    mempoolSnapshotCache = { atMs: Date.now(), info: info || {}, txids };
    return { info: info || {}, txids };
  })();
  mempoolSnapshotInFlight = fetchPromise;
  try {
    return await fetchPromise;
  } finally {
    if (mempoolSnapshotInFlight === fetchPromise) {
      mempoolSnapshotInFlight = null;
    }
  }
}

// GET /api/mempool - Mempool overview + sample transactions
router.get('/', withCachePolicy('short'), async (req: Request, res: Response) => {
  const limitParsed = parseMempoolLimitQuery(req.query as Record<string, unknown>, 20);
  if (!limitParsed.success) {
    return sendValidationError(res, firstValidationIssueMessage(limitParsed.error));
  }
  const { limit } = limitParsed.data;
  const cached = mempoolCache.get(limit);
  if (cached && Date.now() - cached.atMs < MEMPOOL_TTL_MS) {
    return res.json(cached.payload);
  }
  const staleCached =
    cached && Date.now() - cached.atMs < MEMPOOL_STALE_MAX_MS ? cached.payload : null;

  const inFlight = mempoolInFlight.get(limit);
  if (inFlight) {
    try {
      const deduped = await inFlight;
      return res.json(deduped);
    } catch {
      if (staleCached) {
        return res.json(staleCached);
      }
      return sendServiceUnavailable(res, 'Could not fetch mempool data from daemon RPC');
    }
  }

  const fetchPromise = (async () => {
    // Snapshot cache avoids repeated full getrawmempool() list fetches on short intervals.
    const { info, txids } = await getMempoolSnapshot();
    const sample = txids.slice(0, Math.min(limit, 30));

    const txs = await mapWithConcurrency(sample, MEMPOOL_CONCURRENCY, async (txid, index) => {
      try {
        const entry = (await rpcService.getMempoolEntry(txid)) as RpcMempoolEntry;
        let raw: RpcRawTx | null = null;
        if (index < MEMPOOL_RAW_TX_SAMPLE_LIMIT) {
          try {
            raw = (await rpcService.getRawTransaction(txid, true)) as RpcRawTx;
          } catch {
            raw = null;
          }
        }

        const fee =
          entry?.fees?.base ??
          entry?.fees?.modified ??
          entry?.fee ??
          raw?.fee ??
          null;
        const size = entry?.vsize ?? entry?.size ?? raw?.size ?? null;
        const time = entry?.time ?? raw?.time ?? null;
        const totalValueOut = Array.isArray(raw?.vout)
          ? raw.vout.reduce((sum: number, vout) => sum + (vout?.value || 0), 0)
          : null;

        return {
          txid,
          fee,
          size,
          time,
          totalValueOut,
        };
      } catch (err) {
        logger.debug('Could not fetch mempool tx details:', err);
        return { txid };
      }
    });

    const payload = {
      success: true,
      data: {
        info: {
          size: info?.size ?? txids.length,
          bytes: info?.bytes ?? 0,
          usage: info?.usage ?? 0,
          maxmempool: info?.maxmempool ?? 0,
          mempoolminfee: info?.mempoolminfee ?? 0,
          minrelaytxfee: info?.minrelaytxfee ?? 0,
        },
        txs,
      },
    } as const;
    mempoolCache.set(limit, { atMs: Date.now(), payload });
    return payload;
  })();

  mempoolInFlight.set(limit, fetchPromise);
  try {
    const payload = await fetchPromise;
    return res.json(payload);
  } catch (error) {
    logger.debug('Could not fetch mempool data:', error);
    if (staleCached) {
      return res.json(staleCached);
    }
    return sendServiceUnavailable(res, 'Could not fetch mempool data from daemon RPC', error);
  } finally {
    if (mempoolInFlight.get(limit) === fetchPromise) {
      mempoolInFlight.delete(limit);
    }
  }
});

export default router;
