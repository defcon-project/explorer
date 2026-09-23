import { Router, Request, Response } from 'express';
import { Address } from '../models/Address';
import { rpcService } from '../services/rpc.service';
import { config } from '../config';
import { withCachePolicy } from '../middleware/cachePolicy';
import { COIN } from '@defcon/shared';
import { coinToSat, satToBigInt, satToCoin, satToString, type SatLike } from '../utils/amounts';
import {
  firstValidationIssueMessage,
  parsePaginationQuery,
  sendInternalError,
  sendValidationError,
} from '../utils/validation';

const router = Router();

const RICHLIST_PROJECTION = {
  address: 1,
  balanceSat: 1,
  txCount: 1,
  lastSeen: 1,
};

const BALANCE_ONLY_PROJECTION = {
  balanceSat: 1,
};
const RICHLIST_TTL_MS = Math.max(20_000, Math.min(60_000, config.cache.ttlSeconds * 2000));
const DISTRIBUTION_TTL_MS = Math.max(30_000, Math.min(120_000, config.cache.ttlSeconds * 4000));
const RICHLIST_STALE_MAX_MS = Math.max(RICHLIST_TTL_MS * 3, 90_000);
const DISTRIBUTION_STALE_MAX_MS = Math.max(DISTRIBUTION_TTL_MS * 3, 180_000);

type RichlistCachedPage = {
  atMs: number;
  data: ReturnType<typeof buildRanked>;
  total: number;
};
const richlistCache = new Map<string, RichlistCachedPage>();
const richlistInFlight = new Map<string, Promise<RichlistCachedPage>>();

function buildRanked(
  addresses: RichListAddressDoc[],
  skip: number
): Array<{
  rank: number;
  address: string;
  txCount: number;
  balanceSat: string;
  balance: number;
  lastSeen: number;
}> {
  return addresses.map((addr, i) => {
    const balanceSat = satToBigInt(addr.balanceSat);
    return {
      rank: skip + i + 1,
      address: addr.address,
      txCount: addr.txCount ?? 0,
      balanceSat: satToString(balanceSat),
      balance: satToCoin(balanceSat),
      lastSeen: addr.lastSeen ?? 0,
    };
  });
}

type DistributionCacheEntry = {
  atMs: number;
  payload: {
    success: true;
    data: {
      totalAddresses: number;
      moneySupply: number;
      top10: { balance: number; percentage: number };
      top100: { balance: number; percentage: number };
    };
  };
};

let distributionCache: DistributionCacheEntry | null = null;
let distributionInFlight: Promise<DistributionCacheEntry> | null = null;

// Use string range query instead of regex for better index utilization.
// For prefix "D", this matches addresses >= "D" and < "E".
const ADDRESS_PREFIX = COIN.ADDRESS_PREFIX;
const ADDRESS_PREFIX_NEXT = String.fromCharCode(ADDRESS_PREFIX.charCodeAt(ADDRESS_PREFIX.length - 1) + 1);
const LEGACY_ADDRESS_FILTER = {
  $gte: ADDRESS_PREFIX,
  $lt: ADDRESS_PREFIX.slice(0, -1) + ADDRESS_PREFIX_NEXT,
};
type RpcBlockchainInfo = { moneysupply?: number };
type RichListAddressDoc = { address: string; balanceSat?: SatLike; txCount?: number; lastSeen?: number };
type BalanceOnlyDoc = { balanceSat?: SatLike };
type CountDoc = { total?: number };

function percentage(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole) / 100;
}

function buildRichlistResponse(page: number, limit: number, data: RichlistCachedPage) {
  return {
    success: true as const,
    data: data.data,
    pagination: { page, limit, total: data.total, pages: Math.ceil(data.total / limit) },
  };
}

function isFresh(cachedAtMs: number, ttlMs: number): boolean {
  return Date.now() - cachedAtMs < ttlMs;
}

router.get('/', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const paginationParsed = parsePaginationQuery(req.query as Record<string, unknown>, {
      page: 1,
      limit: 100,
    });
    if (!paginationParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(paginationParsed.error));
    }
    const { page, limit } = paginationParsed.data;
    const skip = (page - 1) * limit;
    const cacheKey = `${page}:${limit}`;
    const cached = richlistCache.get(cacheKey);

    if (cached && isFresh(cached.atMs, RICHLIST_TTL_MS)) {
      return res.json(buildRichlistResponse(page, limit, cached));
    }

    const staleFallbackAllowed = !!cached && isFresh(cached.atMs, RICHLIST_STALE_MAX_MS);
    const inflight = richlistInFlight.get(cacheKey);
    if (inflight) {
      try {
        const dedupedData = await inflight;
        return res.json(buildRichlistResponse(page, limit, dedupedData));
      } catch {
        if (staleFallbackAllowed && cached) {
          return res.json(buildRichlistResponse(page, limit, cached));
        }
        throw new Error('Rich list in-flight query failed');
      }
    }

    const fetchPromise = (async (): Promise<RichlistCachedPage> => {
      // Single $facet pass: data page + total count in one collection scan.
      // Sort lives inside the data branch only - the count branch does not need
      // ordered docs, so we avoid sorting the entire matched set twice.
      // Explorer UI is designed around legacy P2PKH-style addresses (DeFCoN: starts with "D").
      // Exclude special/script-derived address formats (e.g. BLS pubkey addresses) from the rich list
      // to keep supply percentages sane and match typical explorer expectations.
      const [facetResult] = await Address.aggregate<{
        data: RichListAddressDoc[];
        countRows: CountDoc[];
      }>([
        { $match: { address: LEGACY_ADDRESS_FILTER } },
        { $match: { balanceSat: { $gt: 0 } } },
        {
          $facet: {
            data: [
              { $sort: { balanceSat: -1, _id: 1 } },
              { $skip: skip },
              { $limit: limit },
              { $project: RICHLIST_PROJECTION },
            ],
            countRows: [{ $count: 'total' }],
          },
        },
      ]);

      const addresses = facetResult?.data ?? [];
      const total = facetResult?.countRows[0]?.total ?? 0;
      const ranked = buildRanked(addresses, skip);
      const entry: RichlistCachedPage = { atMs: Date.now(), data: ranked, total };
      richlistCache.set(cacheKey, entry);
      return entry;
    })();

    richlistInFlight.set(cacheKey, fetchPromise);
    try {
      const freshData = await fetchPromise;
      return res.json(buildRichlistResponse(page, limit, freshData));
    } catch (error) {
      if (staleFallbackAllowed && cached) {
        return res.json(buildRichlistResponse(page, limit, cached));
      }
      throw error;
    } finally {
      if (richlistInFlight.get(cacheKey) === fetchPromise) {
        richlistInFlight.delete(cacheKey);
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch rich list', error);
  }
});

router.get('/distribution', withCachePolicy('short'), async (_req: Request, res: Response) => {
  try {
    if (distributionCache && isFresh(distributionCache.atMs, DISTRIBUTION_TTL_MS)) {
      return res.json(distributionCache.payload);
    }

    const staleFallbackAllowed =
      !!distributionCache && isFresh(distributionCache.atMs, DISTRIBUTION_STALE_MAX_MS);

    if (distributionInFlight) {
      try {
        const dedupedData = await distributionInFlight;
        return res.json(dedupedData.payload);
      } catch {
        if (staleFallbackAllowed && distributionCache) {
          return res.json(distributionCache.payload);
        }
        throw new Error('Distribution in-flight query failed');
      }
    }

    const fetchPromise = (async () => {
      // Parallel queries: countDocuments uses index fast-path; find+sort+limit(100)
      // uses the balanceSat index and stops after 100 docs - faster than $facet
      // which must sort the entire collection before splitting into branches.
      const filter = { address: LEGACY_ADDRESS_FILTER, balanceSat: { $gt: 0 } };
      const [totalAddresses, top100] = await Promise.all([
        Address.countDocuments(filter),
        Address.find(filter)
          .sort({ balanceSat: -1 })
          .limit(100)
          .select(BALANCE_ONLY_PROJECTION)
          .lean<BalanceOnlyDoc[]>(),
      ]);
      const top10 = top100.slice(0, 10);

      let moneySupply = 0;
      let moneySupplySat = 0n;
      try {
        const chainInfo = (await rpcService.getBlockchainInfo()) as RpcBlockchainInfo;
        moneySupply = chainInfo?.moneysupply ?? 0;
        moneySupplySat = coinToSat(moneySupply);
      } catch {
        // If daemon is unavailable, fall back to MongoDB aggregation sum.
        const [supplyAgg] = await Address.aggregate<{ totalSat: number }>([
          { $match: { address: LEGACY_ADDRESS_FILTER, balanceSat: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              totalSat: {
                $sum: { $convert: { input: '$balanceSat', to: 'long', onError: 0, onNull: 0 } },
              },
            },
          },
        ]);
        if (supplyAgg && supplyAgg.totalSat > 0) {
          moneySupplySat = BigInt(supplyAgg.totalSat);
          moneySupply = satToCoin(moneySupplySat);
        }
      }

      const top10SumSat = top10.reduce((sum, a) => sum + satToBigInt(a.balanceSat), 0n);
      const top100SumSat = top100.reduce((sum, a) => sum + satToBigInt(a.balanceSat), 0n);
      const top10Sum = satToCoin(top10SumSat);
      const top100Sum = satToCoin(top100SumSat);
      const denominatorSat = moneySupplySat > 0n ? moneySupplySat : coinToSat(moneySupply);

      const payload = {
        success: true,
        data: {
          totalAddresses,
          moneySupply,
          top10: {
            balance: top10Sum,
            percentage: percentage(top10SumSat, denominatorSat),
          },
          top100: {
            balance: top100Sum,
            percentage: percentage(top100SumSat, denominatorSat),
          },
        },
      } as const;

      const entry = { atMs: Date.now(), payload };
      distributionCache = entry;
      return entry;
    })();

    distributionInFlight = fetchPromise;
    try {
      const freshData = await fetchPromise;
      return res.json(freshData.payload);
    } catch (error) {
      if (staleFallbackAllowed && distributionCache) {
        return res.json(distributionCache.payload);
      }
      throw error;
    } finally {
      if (distributionInFlight === fetchPromise) {
        distributionInFlight = null;
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch distribution', error);
  }
});

export function invalidateRichlistCache(): void {
  richlistCache.clear();
  richlistInFlight.clear();
  distributionCache = null;
  distributionInFlight = null;
}

export default router;
