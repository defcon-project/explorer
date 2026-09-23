import { Router, Request, Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { withCachePolicy } from '../middleware/cachePolicy';
import { logger } from '../utils/logger';
import {
  firstValidationIssueMessage,
  parseMarketDaysQuery,
  sendValidationError,
} from '../utils/validation';

const router = Router();
const MARKET_CACHE_TTL_MS = Math.max(5, Math.max(config.cache.ttlSeconds, 0)) * 1000;
const MARKET_STALE_MAX_MS = Math.max(MARKET_CACHE_TTL_MS * 4, 60_000);
const MARKET_STALE_AFTER_MS = 10 * 60 * 1000;

type MarketSource = 'coingecko' | 'qutrade';
type MarketFreshness = 'fresh' | 'stale' | 'unknown';

type MarketSnapshotPayload = {
  success: true;
  data: {
    available: boolean;
    source: MarketSource | null;
    lastUpdatedAt: string | null;
    freshness: MarketFreshness;
    ageSeconds: number | null;
    price: {
      usd: number | null;
      btc: number | null;
      change24h: number | null;
      volume24h: number | null;
      marketCap: number | null;
    } | null;
  };
};

type MarketHistoryPayload = {
  success: true;
  data: {
    available: boolean;
    source: MarketSource | null;
    days: number | null;
    points: Array<{
      timestamp: number;
      priceUsd: number;
      volumeUsd: number | null;
    }>;
  };
};

type QutradeTicker = {
  pair?: string;
  // API v1 field names (qutrade /market_data/ endpoint returns these)
  price?: number | string;      // last traded price
  asset_2_volume?: number | string; // quoted-currency volume (e.g. USDT)
  asset_1_volume?: number | string; // base-currency volume (e.g. DFCN)
  timestamp?: number | string;
  trend?: number | string;      // % change from open (as decimal or percent)
  // Legacy / alternative field names kept for forward-compat
  last_price?: number | string;
  vol_din?: number | string;
  vol?: number | string;
  updated?: number | string;
  open?: number | string;
  pct_change?: number | string;
};

type QutradeTrade = {
  timestamp?: number | string;
  price?: number | string;
  rate?: number | string;
  amount?: number | string;
  total?: number | string;
};

let snapshotCache: { atMs: number; key: string; payload: MarketSnapshotPayload } | null = null;
const snapshotInFlight = new Map<string, Promise<MarketSnapshotPayload>>();
const HISTORY_CACHE_MAX_ENTRIES = 16;
// JS Map preserves insertion order; deleting then re-setting moves a key to
// the back, giving us cheap O(1) LRU semantics without an external dep.
const historyCache = new Map<string, { atMs: number; payload: MarketHistoryPayload }>();
const historyInFlight = new Map<string, Promise<MarketHistoryPayload>>();

function isFresh(atMs: number): boolean {
  return Date.now() - atMs < MARKET_CACHE_TTL_MS;
}

function isStaleEligible(atMs: number): boolean {
  return Date.now() - atMs < MARKET_STALE_MAX_MS;
}

function resolveMarketFreshness(lastUpdatedAt: string | null): {
  freshness: MarketFreshness;
  ageSeconds: number | null;
} {
  if (!lastUpdatedAt) return { freshness: 'unknown', ageSeconds: null };
  const updatedAtMs = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(updatedAtMs)) return { freshness: 'unknown', ageSeconds: null };

  const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAtMs) / 1000));
  return {
    freshness: ageSeconds * 1000 >= MARKET_STALE_AFTER_MS ? 'stale' : 'fresh',
    ageSeconds,
  };
}

function rememberHistory(key: string, payload: MarketHistoryPayload): void {
  // Refresh: re-insertion moves to the most-recently-used position.
  if (historyCache.has(key)) historyCache.delete(key);
  historyCache.set(key, { atMs: Date.now(), payload });

  // Hard cap: evict the least-recently-used entry (first key in insertion
  // order). Without this an attacker could request many distinct day windows
  // to grow the cache without bound.
  while (historyCache.size > HISTORY_CACHE_MAX_ENTRIES) {
    const firstKey = historyCache.keys().next().value;
    if (firstKey === undefined) break;
    historyCache.delete(firstKey);
  }
}

function getMarketSource(): MarketSource {
  return config.market.source === 'qutrade' ? 'qutrade' : 'coingecko';
}

function snapshotUnavailable(source: MarketSource | null): MarketSnapshotPayload {
  return {
    success: true,
    data: {
      available: false,
      source,
      lastUpdatedAt: null,
      freshness: 'unknown',
      ageSeconds: null,
      price: null,
    },
  };
}

function historyUnavailable(source: MarketSource | null, days: number | null): MarketHistoryPayload {
  return {
    success: true,
    data: {
      available: false,
      source,
      days,
      points: [],
    },
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toEpochMs(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric != null && numeric > 0) {
    // Qutrade typically uses Unix seconds, but guard for milliseconds too.
    return numeric > 9_999_999_999 ? Math.trunc(numeric) : Math.trunc(numeric * 1000);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function normalizePairKey(value: string): string {
  return value.trim().toLowerCase();
}

function parseQutradeTickerMap(data: unknown): Record<string, QutradeTicker> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const record = data as Record<string, unknown>;
  // Qutrade API v1 wraps tickers under a "list" key; fall back to "pairs" then top-level.
  const candidate = record.list ?? record.pairs;
  const entries =
    candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? Object.entries(candidate as Record<string, unknown>)
      : Object.entries(record);

  const out: Record<string, QutradeTicker> = {};
  for (const [entryKey, value] of entries) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const ticker = value as QutradeTicker;
    const pairKey = normalizePairKey(String(ticker.pair || entryKey));
    if (!pairKey) continue;
    out[pairKey] = ticker;
  }
  return out;
}

function parseQutradeTrades(data: unknown): QutradeTrade[] {
  if (Array.isArray(data)) return data as QutradeTrade[];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];

  const record = data as Record<string, unknown>;
  // Qutrade API v1 wraps trades under "list"; also handle legacy field names
  if (Array.isArray(record.list)) return record.list as QutradeTrade[];
  if (Array.isArray(record.result)) return record.result as QutradeTrade[];
  if (Array.isArray(record.data)) return record.data as QutradeTrade[];
  if (Array.isArray(record.trades)) return record.trades as QutradeTrade[];
  return [];
}

function getSnapshotCacheKey(source: MarketSource): string | null {
  if (source === 'qutrade') {
    return [
      'qutrade',
      config.market.qutradeApiBaseUrl,
      config.market.qutradePairUsdt,
      config.market.qutradePairBtc,
    ].join(':');
  }

  const id = config.market.coingeckoId.trim();
  if (!id) return null;
  return `coingecko:${id}`;
}

function getHistoryCacheKey(source: MarketSource, days: number): string | null {
  if (source === 'qutrade') {
    return [
      'qutrade',
      config.market.qutradeApiBaseUrl,
      config.market.qutradeHistoryPair,
      String(days),
      String(config.market.qutradeTradesLimit),
    ].join(':');
  }

  const id = config.market.coingeckoId.trim();
  if (!id) return null;
  return `coingecko:${id}:${days}`;
}

async function fetchCoingeckoSnapshot(): Promise<MarketSnapshotPayload> {
  const id = config.market.coingeckoId.trim();
  if (!id) return snapshotUnavailable(null);

  const { data } = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
    params: {
      ids: id,
      vs_currencies: 'usd,btc',
      include_24hr_change: true,
      include_24hr_vol: true,
      include_market_cap: true,
      include_last_updated_at: true,
    },
    timeout: 15000,
  });

  const snap = data?.[id];
  if (!snap) return snapshotUnavailable('coingecko');

  const lastUpdatedAt = snap?.last_updated_at ? new Date(snap.last_updated_at * 1000).toISOString() : null;
  return {
    success: true,
    data: {
      available: true,
      source: 'coingecko',
      lastUpdatedAt,
      ...resolveMarketFreshness(lastUpdatedAt),
      price: {
        usd: toFiniteNumber(snap?.usd),
        btc: toFiniteNumber(snap?.btc),
        change24h: toFiniteNumber(snap?.usd_24h_change),
        volume24h: toFiniteNumber(snap?.usd_24h_vol),
        marketCap: toFiniteNumber(snap?.usd_market_cap),
      },
    },
  };
}

async function fetchCoingeckoHistory(days: number): Promise<MarketHistoryPayload> {
  const id = config.market.coingeckoId.trim();
  if (!id) return historyUnavailable(null, null);

  const { data } = await axios.get(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart`, {
    params: { vs_currency: 'usd', days },
    timeout: 15000,
  });

  const prices = Array.isArray(data?.prices) ? data.prices : [];
  const volumes = Array.isArray(data?.total_volumes) ? data.total_volumes : [];

  const points = prices
    .map((entry: unknown, index: number) => {
      if (!Array.isArray(entry)) return null;
      const ts = toFiniteNumber(entry[0]);
      const price = toFiniteNumber(entry[1]);
      if (ts == null || price == null) return null;

      const volEntry = Array.isArray(volumes[index]) ? volumes[index] : null;
      const volumeUsd = volEntry ? toFiniteNumber(volEntry[1]) : null;

      return {
        timestamp: Math.floor(ts / 1000),
        priceUsd: price,
        volumeUsd,
      };
    })
    .filter(
      (
        item: { timestamp: number; priceUsd: number; volumeUsd: number | null } | null
      ): item is { timestamp: number; priceUsd: number; volumeUsd: number | null } => item != null
    );

  return {
    success: true,
    data: {
      available: points.length > 0,
      source: 'coingecko',
      days,
      points,
    },
  };
}

async function fetchQutradeSnapshot(): Promise<MarketSnapshotPayload> {
  const baseUrl = config.market.qutradeApiBaseUrl;
  const pairUsdt = normalizePairKey(config.market.qutradePairUsdt);
  const pairBtc = normalizePairKey(config.market.qutradePairBtc);
  const pairs = [pairUsdt, pairBtc].filter(Boolean);

  if (!baseUrl || pairs.length === 0) return snapshotUnavailable('qutrade');

  const { data } = await axios.get(`${baseUrl}/market_data/`, {
    params: { pair: pairs.join(',') },
    timeout: 15000,
  });

  const tickers = parseQutradeTickerMap(data);
  const usdtTicker = tickers[pairUsdt];
  const btcTicker = tickers[pairBtc];

  const usd = toFiniteNumber(usdtTicker?.price) ?? toFiniteNumber(usdtTicker?.last_price);
  const btc = toFiniteNumber(btcTicker?.price) ?? toFiniteNumber(btcTicker?.last_price);
  if (usd == null && btc == null) return snapshotUnavailable('qutrade');

  // Qutrade v1: asset_2_volume = quoted-currency vol (USDT), fall back to older vol_din/vol field names
  const volumeQuoted = toFiniteNumber(usdtTicker?.asset_2_volume) ?? toFiniteNumber(usdtTicker?.vol_din);
  const volumeBase = toFiniteNumber(usdtTicker?.asset_1_volume) ?? toFiniteNumber(usdtTicker?.vol);
  const volume24h = volumeQuoted ?? (volumeBase != null && usd != null ? volumeBase * usd : null);

  // Qutrade v1: "trend" is % change (may be 0 string when no trades); fall back to open-based calc
  const change24hFromTicker = toFiniteNumber(usdtTicker?.pct_change) ?? toFiniteNumber(usdtTicker?.trend);
  const open = toFiniteNumber(usdtTicker?.open);
  const change24h =
    (change24hFromTicker != null && change24hFromTicker !== 0) ? change24hFromTicker :
    (open != null && open > 0 && usd != null ? ((usd - open) / open) * 100 : null);

  const updatedMs = [toEpochMs(usdtTicker?.timestamp ?? usdtTicker?.updated), toEpochMs(btcTicker?.timestamp ?? btcTicker?.updated)]
    .filter((value): value is number => value != null)
    .sort((a, b) => b - a)[0];
  const lastUpdatedAt = typeof updatedMs === 'number' ? new Date(updatedMs).toISOString() : null;

  return {
    success: true,
    data: {
      available: true,
      source: 'qutrade',
      lastUpdatedAt,
      ...resolveMarketFreshness(lastUpdatedAt),
      price: {
        usd,
        btc,
        change24h,
        volume24h,
        marketCap: null,
      },
    },
  };
}

async function fetchQutradeHistory(days: number): Promise<MarketHistoryPayload> {
  const baseUrl = config.market.qutradeApiBaseUrl;
  const pair = normalizePairKey(config.market.qutradeHistoryPair);
  if (!baseUrl || !pair) return historyUnavailable('qutrade', days);
  if (!pair.endsWith('_usdt')) return historyUnavailable('qutrade', days);

  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = Math.max(0, nowSec - days * 86400);
  const { data } = await axios.get(`${baseUrl}/market_trades/`, {
    params: {
      pair,
      from: fromSec,
      to: nowSec,
      limit: config.market.qutradeTradesLimit,
    },
    timeout: 15000,
  });

  const points = parseQutradeTrades(data)
    .map((trade) => {
      const tsMs = toEpochMs(trade.timestamp);
      const price = toFiniteNumber(trade.price) ?? toFiniteNumber(trade.rate);
      if (tsMs == null || price == null) return null;

      const total = toFiniteNumber(trade.total);
      const amount = toFiniteNumber(trade.amount);
      const volumeUsd = total ?? (amount != null ? amount * price : null);

      return {
        timestamp: Math.floor(tsMs / 1000),
        priceUsd: price,
        volumeUsd,
      };
    })
    .filter(
      (
        item: { timestamp: number; priceUsd: number; volumeUsd: number | null } | null
      ): item is { timestamp: number; priceUsd: number; volumeUsd: number | null } => item != null
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    success: true,
    data: {
      available: points.length > 0,
      source: 'qutrade',
      days,
      points,
    },
  };
}

async function fetchSnapshotForSource(source: MarketSource): Promise<MarketSnapshotPayload> {
  if (source === 'qutrade') return fetchQutradeSnapshot();
  return fetchCoingeckoSnapshot();
}

async function fetchHistoryForSource(source: MarketSource, days: number): Promise<MarketHistoryPayload> {
  if (source === 'qutrade') return fetchQutradeHistory(days);
  return fetchCoingeckoHistory(days);
}

// GET /api/market - Current market snapshot
router.get('/', withCachePolicy('short'), async (_req: Request, res: Response) => {
  const source = getMarketSource();
  const snapshotKey = getSnapshotCacheKey(source);
  const requestKey = snapshotKey ?? `source:${source}`;
  const freshCached =
    snapshotKey && snapshotCache && snapshotCache.key === snapshotKey && isFresh(snapshotCache.atMs)
      ? snapshotCache.payload
      : null;
  if (freshCached) {
    return res.json(freshCached);
  }
  const staleCached =
    snapshotKey && snapshotCache && snapshotCache.key === snapshotKey && isStaleEligible(snapshotCache.atMs)
      ? snapshotCache.payload
      : null;

  const inFlight = snapshotInFlight.get(requestKey);
  if (inFlight) {
    try {
      const deduped = await inFlight;
      return res.json(deduped);
    } catch {
      if (staleCached) {
        return res.json(staleCached);
      }
      return res.json(snapshotUnavailable(source));
    }
  }

  const fetchPromise = (async () => {
    const payload = await fetchSnapshotForSource(source);
    if (snapshotKey) {
      snapshotCache = { atMs: Date.now(), key: snapshotKey, payload };
    }
    return payload;
  })();

  snapshotInFlight.set(requestKey, fetchPromise);
  try {
    const payload = await fetchPromise;
    return res.json(payload);
  } catch (error) {
    logger.debug('Could not fetch market data:', error);
    if (staleCached) {
      return res.json(staleCached);
    }
    return res.json(snapshotUnavailable(source));
  } finally {
    if (snapshotInFlight.get(requestKey) === fetchPromise) {
      snapshotInFlight.delete(requestKey);
    }
  }
});

// GET /api/market/history - Price + volume history
router.get('/history', withCachePolicy('short'), async (req: Request, res: Response) => {
  const daysParsed = parseMarketDaysQuery(req.query as Record<string, unknown>, 30);
  if (!daysParsed.success) {
    return sendValidationError(res, firstValidationIssueMessage(daysParsed.error));
  }

  const { days } = daysParsed.data;
  const source = getMarketSource();
  const historyKey = getHistoryCacheKey(source, days);
  const requestKey = historyKey ?? `${source}:${days}`;
  const cachedHistoryEntry = historyKey ? historyCache.get(historyKey) : null;
  const staleCached =
    cachedHistoryEntry && isStaleEligible(cachedHistoryEntry.atMs) ? cachedHistoryEntry.payload : null;

  if (historyKey) {
    if (cachedHistoryEntry && isFresh(cachedHistoryEntry.atMs)) {
      return res.json(cachedHistoryEntry.payload);
    }
  }

  const inFlight = historyInFlight.get(requestKey);
  if (inFlight) {
    try {
      const deduped = await inFlight;
      return res.json(deduped);
    } catch {
      if (staleCached) {
        return res.json(staleCached);
      }
      return res.json(historyUnavailable(source, days));
    }
  }

  const fetchPromise = (async () => {
    const payload = await fetchHistoryForSource(source, days);
    if (historyKey) rememberHistory(historyKey, payload);
    return payload;
  })();

  historyInFlight.set(requestKey, fetchPromise);
  try {
    const payload = await fetchPromise;
    return res.json(payload);
  } catch (error) {
    logger.debug('Could not fetch market history:', error);
    if (staleCached) {
      return res.json(staleCached);
    }
    return res.json(historyUnavailable(source, days));
  } finally {
    if (historyInFlight.get(requestKey) === fetchPromise) {
      historyInFlight.delete(requestKey);
    }
  }
});

export default router;
