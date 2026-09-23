import { Router, Request, Response } from 'express';
import { Transaction } from '../../models/Transaction';
import { config } from '../../config';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { normalizeTransactionAmounts, satToBigInt } from '../../utils/amounts';
import {
  firstValidationIssueMessage,
  parseV1LatestCount,
  sendInternalError,
  sendValidationError,
} from '../../utils/validation';

const router = Router();
const V1_LATEST_TXS_TTL_MS = Math.max(1000, Math.min(10_000, config.cache.ttlSeconds * 1000));
const V1_LATEST_TXS_STALE_MAX_MS = Math.max(V1_LATEST_TXS_TTL_MS * 4, 60_000);
const V1_LATEST_TXS_CACHE_LIMIT = 32;
type V1LatestTxsPayload = { success: true; data: Array<Record<string, unknown>> };
const latestV1TxsCache = new Map<number, { atMs: number; payload: V1LatestTxsPayload }>();
const latestV1TxsInFlight = new Map<number, Promise<V1LatestTxsPayload>>();

const TX_PROJECTION = {
  txid: 1,
  blockheight: 1,
  blocktime: 1,
  totalValueInSat: 1,
  totalValueOutSat: 1,
  feeSat: 1,
  isCoinbase: 1,
  'vout.valueSat': 1,
  'vout.scriptPubKey.addresses': { $slice: 1 },
};

function classifyTx(tx: Record<string, unknown>): string {
  const isDonation = tx.isDonation === true;
  if (isDonation) return 'donation';

  const isCoinbase = tx.isCoinbase === true;
  if (isCoinbase) return 'blockReward';

  const feeSat = satToBigInt(tx.feeSat as Parameters<typeof satToBigInt>[0]);
  const totalInSat = satToBigInt(tx.totalValueInSat as Parameters<typeof satToBigInt>[0]);
  const totalOutSat = satToBigInt(tx.totalValueOutSat as Parameters<typeof satToBigInt>[0]);
  if (feeSat === 0n && totalOutSat > totalInSat) return 'stakeReward';
  return 'normal';
}

function getLatestTxsCache(count: number): V1LatestTxsPayload | null {
  const entry = latestV1TxsCache.get(count);
  if (!entry) return null;
  if (Date.now() - entry.atMs >= V1_LATEST_TXS_TTL_MS) {
    latestV1TxsCache.delete(count);
    return null;
  }
  latestV1TxsCache.delete(count);
  latestV1TxsCache.set(count, entry);
  return entry.payload;
}

function getLatestTxsStaleCache(count: number): V1LatestTxsPayload | null {
  const entry = latestV1TxsCache.get(count);
  if (!entry) return null;
  if (Date.now() - entry.atMs >= V1_LATEST_TXS_STALE_MAX_MS) {
    latestV1TxsCache.delete(count);
    return null;
  }
  return entry.payload;
}

function setLatestTxsCache(count: number, payload: V1LatestTxsPayload): void {
  if (latestV1TxsCache.has(count)) latestV1TxsCache.delete(count);
  while (latestV1TxsCache.size >= V1_LATEST_TXS_CACHE_LIMIT) {
    const oldestKey = latestV1TxsCache.keys().next().value;
    if (oldestKey === undefined) break;
    latestV1TxsCache.delete(oldestKey);
  }
  latestV1TxsCache.set(count, { atMs: Date.now(), payload });
}

router.get('/latest', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const countParsed = parseV1LatestCount(req.query as Record<string, unknown>, 10);
    if (!countParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(countParsed.error));
    }
    const { count } = countParsed.data;
    const cached = getLatestTxsCache(count);
    if (cached) {
      return res.json(cached);
    }
    const staleCached = getLatestTxsStaleCache(count);

    const inFlight = latestV1TxsInFlight.get(count);
    if (inFlight) {
      try {
        const deduped = await inFlight;
        return res.json(deduped);
      } catch {
        if (staleCached) {
          return res.json(staleCached);
        }
        throw new Error('V1 latest txs in-flight query failed');
      }
    }

    const fetchPromise = (async () => {
      const txs = await Transaction.find()
        .sort({ blockheight: -1, _id: -1 })
        .limit(count)
        .select(TX_PROJECTION)
        .lean();

      const data = txs.map((tx) => {
        const normalized = normalizeTransactionAmounts(tx, { maxVoutAddresses: 1 });
        return {
          ...normalized,
          txType: classifyTx(normalized),
        };
      });
      const payload: V1LatestTxsPayload = { success: true, data };
      setLatestTxsCache(count, payload);
      return payload;
    })();

    latestV1TxsInFlight.set(count, fetchPromise);
    try {
      const payload = await fetchPromise;
      return res.json(payload);
    } catch (error) {
      if (staleCached) {
        return res.json(staleCached);
      }
      throw error;
    } finally {
      if (latestV1TxsInFlight.get(count) === fetchPromise) {
        latestV1TxsInFlight.delete(count);
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch latest transactions', error);
  }
});

export default router;
