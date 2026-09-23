import { Router, Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';
import { COIN } from '@defcon/shared';
import {
  banWaveAnalysisApiResponseSchema,
  masternodeEventsApiResponseSchema,
  masternodeHealthApiResponseSchema,
  type BanWaveAnalysisApiResponse,
  type MasternodeEventsApiResponse,
  type MasternodeHealthApiResponse,
} from '@defcon/shared/dist/contracts';
import { config } from '../../config';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { MasternodeEvent } from '../../models/MasternodeEvent';
import { NodeInventory } from '../../models/NodeInventory';
import { getEnrichedNodes } from '../../services/masternode.service';
import { rpcService } from '../../services/rpc.service';
import {
  banEventIdentity,
  buildBanWaves,
  classifyHistoricalBanEvents,
  isActiveMasternodeStatus,
  type BanWaveSeverity,
  type HistoricalBanEvent,
} from '../../domain/pose/banAnalytics';
import {
  mapBanWaveNode,
  mapStoredBanEvent,
  type BanWavePresentationNode,
} from '../../domain/pose/banPresentation';
import {
  firstValidationIssueMessage,
  masternodeIdParamSchema,
  parseV1EventsLimit,
  sendInternalError,
  sendServiceUnavailable,
  sendValidationError,
} from '../../utils/validation';

const router = Router();
const ANALYTICS_CACHE_TTL_MS = Math.max(15_000, Math.min(120_000, config.cache.ttlSeconds * 4_000));
const ANALYTICS_STALE_MAX_MS = Math.max(ANALYTICS_CACHE_TTL_MS * 4, 5 * 60_000);
const ANALYTICS_CACHE_LIMIT = 32;
type CachedAnalyticsPayload = MasternodeHealthApiResponse | BanWaveAnalysisApiResponse;
const analyticsCache = new Map<string, { atMs: number; expiresAt: number; payload: CachedAnalyticsPayload }>();
const analyticsInFlight = new Map<string, Promise<CachedAnalyticsPayload>>();
type CachedEventsPayload = MasternodeEventsApiResponse;
const EVENTS_CACHE_TTL_MS = Math.max(10_000, Math.min(60_000, config.cache.ttlSeconds * 2_000));
const EVENTS_STALE_MAX_MS = Math.max(EVENTS_CACHE_TTL_MS * 4, 120_000);
const EVENTS_CACHE_LIMIT = 48;
const eventsCache = new Map<string, { atMs: number; payload: CachedEventsPayload }>();
const eventsInFlight = new Map<string, Promise<CachedEventsPayload>>();

type PeerMeta = {
  peerCount: number;
  walletVersion: string | null;
  protocolVersion: number | null;
};

function normalizeWalletVersionLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!cleaned) return null;
  return cleaned.replace(/^DeFCoN:/i, '');
}

function parsePeerHost(addr: unknown): string {
  const raw = typeof addr === 'string' ? addr.trim() : '';
  if (!raw) return '';
  const bracketed = raw.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  const lastColon = raw.lastIndexOf(':');
  if (lastColon > -1 && raw.indexOf(':') === lastColon) return raw.slice(0, lastColon);
  return raw;
}

async function getPeerMetaByIp(): Promise<Map<string, PeerMeta>> {
  const peers = (await rpcService.getPeerInfo()) as Array<{
    addr?: string;
    subver?: string;
    version?: number;
  }>;
  const map = new Map<string, PeerMeta>();
  for (const peer of peers || []) {
    const host = parsePeerHost(peer.addr);
    if (!host) continue;
    const current = map.get(host) || { peerCount: 0, walletVersion: null, protocolVersion: null };
    current.peerCount += 1;
    const walletVersion = normalizeWalletVersionLabel(peer.subver);
    if (!current.walletVersion && walletVersion) current.walletVersion = walletVersion;
    if (current.protocolVersion == null && typeof peer.version === 'number') {
      current.protocolVersion = peer.version;
    }
    map.set(host, current);
  }
  return map;
}

function getAnalyticsCache(key: string): CachedAnalyticsPayload | null {
  const entry = analyticsCache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    analyticsCache.delete(key);
    return null;
  }

  // LRU touch
  analyticsCache.delete(key);
  analyticsCache.set(key, entry);
  return entry.payload;
}

function getAnalyticsStaleCache(key: string): CachedAnalyticsPayload | null {
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.atMs > ANALYTICS_STALE_MAX_MS) {
    analyticsCache.delete(key);
    return null;
  }
  return entry.payload;
}

function setAnalyticsCache(key: string, payload: CachedAnalyticsPayload): void {
  if (analyticsCache.size >= ANALYTICS_CACHE_LIMIT) {
    const oldestKey = analyticsCache.keys().next().value;
    if (oldestKey) analyticsCache.delete(oldestKey);
  }
  analyticsCache.set(key, {
    atMs: Date.now(),
    expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS,
    payload,
  });
}

function setEventsCache(key: string, payload: CachedEventsPayload): void {
  if (eventsCache.has(key)) {
    eventsCache.delete(key);
  } else if (eventsCache.size >= EVENTS_CACHE_LIMIT) {
    const oldestKey = eventsCache.keys().next().value;
    if (oldestKey) eventsCache.delete(oldestKey);
  }
  eventsCache.set(key, { atMs: Date.now(), payload });
}

function getEventsCache(key: string): CachedEventsPayload | null {
  const entry = eventsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.atMs > EVENTS_CACHE_TTL_MS) {
    eventsCache.delete(key);
    return null;
  }
  eventsCache.delete(key);
  eventsCache.set(key, entry);
  return entry.payload;
}

function getEventsStaleCache(key: string): CachedEventsPayload | null {
  const entry = eventsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.atMs > EVENTS_STALE_MAX_MS) {
    eventsCache.delete(key);
    return null;
  }
  return entry.payload;
}

function toIsoDate(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Masternode event contains an invalid ${field} timestamp`);
  }
  return date.toISOString();
}

function serializeMasternodeEvent(event: Record<string, unknown>) {
  return {
    ...event,
    ...(event._id == null ? {} : { _id: String(event._id) }),
    detectedAt: toIsoDate(event.detectedAt, 'detectedAt'),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Collection-level routes (must be declared BEFORE `/:id` to avoid route conflict)
// ───────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/masternodes/events
 * Recent masternode status-change events with optional filtering.
 *
 * Query params:
 *   - limit:       1..1000 (default 200)
 *   - hours:       1..720  (default 168 = 7 days)
 *   - status:      filter by currentStatus (e.g. POSE_BANNED, REMOVED, ENABLED, NEW, POSE_PENALTY)
 *   - nodeId:      filter by exact nodeId
 */
router.get('/events', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1), 1000);
    const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? '168'), 10) || 168, 1), 720);
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : null;
    const nodeId = typeof req.query.nodeId === 'string' ? req.query.nodeId : null;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const filter: Record<string, unknown> = { detectedAt: { $gte: since } };
    if (status) filter.currentStatus = status;
    if (nodeId) filter.nodeId = nodeId;

    const cacheKey = `events:${hours}:${limit}:${status ?? '*'}:${nodeId ?? '*'}`;
    const cached = getEventsCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    const staleCached = getEventsStaleCache(cacheKey);
    const inFlight = eventsInFlight.get(cacheKey);
    if (inFlight) {
      try {
        const dedupedPayload = await inFlight;
        return res.json(dedupedPayload);
      } catch {
        if (staleCached) {
          return res.json(staleCached);
        }
        throw new Error('masternode events in-flight query failed');
      }
    }

    const fetchPromise = (async (): Promise<CachedEventsPayload> => {
      const events = (await MasternodeEvent.find(filter)
        .sort({ detectedAt: -1 })
        .limit(limit)
        .lean()) as Array<Record<string, unknown>>;

      const payload = masternodeEventsApiResponseSchema.parse({
        success: true,
        data: {
          windowHours: hours,
          count: events.length,
          events: events.map(serializeMasternodeEvent),
        },
      });
      setEventsCache(cacheKey, payload);
      return payload;
    })();

    eventsInFlight.set(cacheKey, fetchPromise);
    try {
      const payload = await fetchPromise;
      return res.json(payload);
    } catch (error) {
      if (staleCached) {
        return res.json(staleCached);
      }
      throw error;
    } finally {
      if (eventsInFlight.get(cacheKey) === fetchPromise) {
        eventsInFlight.delete(cacheKey);
      }
    }
  } catch (error) {
    sendInternalError(res, 'Failed to fetch masternode events', error);
  }
});

/**
 * GET /api/v1/masternodes/health
 * Aggregated MN health metrics:
 *   - status distribution (live snapshot from RPC)
 *   - drop timeline (POSE_BANNED + REMOVED) bucketed hourly/daily
 *   - top "drop offenders" — nodes with the most POSE_BANNED/REMOVED events
 *   - recent critical events
 *   - daemon-reported PoSe penalty stats (if available)
 *
 * Query params:
 *   - hours:       1..720  (default 168 = 7 days)
 *   - bucket:      'hour' | 'day' (default 'day' if hours > 48 else 'hour')
 *   - topN:        1..50  (default 10)
 */
router.get('/health', withCachePolicy('short'), async (req: Request, res: Response) => {
  let inFlightResolve: ((payload: CachedAnalyticsPayload) => void) | null = null;
  let inFlightReject: ((reason?: unknown) => void) | null = null;
  let inFlightRegistered = false;
  let cacheKey = '';
  let staleCached: CachedAnalyticsPayload | null = null;
  try {
    const hours = Math.min(Math.max(parseInt(String(req.query.hours ?? '168'), 10) || 168, 1), 720);
    const requestedBucket = String(req.query.bucket ?? '').toLowerCase();
    const bucket: 'hour' | 'day' =
      requestedBucket === 'hour' || requestedBucket === 'day'
        ? (requestedBucket as 'hour' | 'day')
        : hours > 48
          ? 'day'
          : 'hour';
    const topN = Math.min(Math.max(parseInt(String(req.query.topN ?? '10'), 10) || 10, 1), 50);
    cacheKey = `health:${hours}:${bucket}:${topN}`;
    const cached = getAnalyticsCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    staleCached = getAnalyticsStaleCache(cacheKey);

    const existingInFlight = analyticsInFlight.get(cacheKey);
    if (existingInFlight) {
      try {
        const payload = await existingInFlight;
        return res.json(payload);
      } catch {
        if (staleCached) {
          return res.json(staleCached);
        }
        throw new Error('masternode health in-flight query failed');
      }
    }

    const inFlightPromise = new Promise<CachedAnalyticsPayload>((resolve, reject) => {
      inFlightResolve = resolve;
      inFlightReject = reject;
    });
    analyticsInFlight.set(cacheKey, inFlightPromise);
    inFlightRegistered = true;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // 1. Live RPC snapshot (status distribution + counts)
    let liveNodes: Awaited<ReturnType<typeof getEnrichedNodes>> = [];
    let rpcAvailable = true;
    try {
      liveNodes = await getEnrichedNodes();
    } catch {
      rpcAvailable = false;
    }

    const statusCounts: Record<string, number> = {};
    let withPoseBanHeight = 0;
    for (const n of liveNodes) {
      statusCounts[n.status] = (statusCounts[n.status] ?? 0) + 1;
      if (n.poseBanHeight) withPoseBanHeight += 1;
    }
    const total = liveNodes.length;
    const strictEnabled = statusCounts.ENABLED ?? 0;
    const poseBanned = statusCounts.POSE_BANNED ?? 0;
    const posePenalty = statusCounts.POSE_PENALTY ?? 0;
    const enabled = strictEnabled + posePenalty;
    const healthScore = total > 0 ? Math.round((enabled / total) * 1000) / 10 : 0;

    // 2..4. Parallel Mongo aggregations
    const dateFormat = bucket === 'hour' ? '%Y-%m-%dT%H:00:00Z' : '%Y-%m-%d';
    const dropStatuses = ['POSE_BANNED', 'REMOVED'];

    const [timelineRaw, offendersRaw, recentCritical, statusBreakdown, banEventsRaw] = await Promise.all([
      // Timeline: drop events bucketed by time + status
      MasternodeEvent.aggregate([
        { $match: { detectedAt: { $gte: since }, currentStatus: { $in: dropStatuses } } },
        {
          $group: {
            _id: {
              bucket: { $dateToString: { format: dateFormat, date: '$detectedAt', timezone: 'UTC' } },
              status: '$currentStatus',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.bucket': 1 } },
      ]),

      // Top offenders: most drop events per nodeId
      MasternodeEvent.aggregate([
        { $match: { detectedAt: { $gte: since }, currentStatus: { $in: dropStatuses } } },
        {
          $group: {
            _id: '$nodeId',
            dropCount: { $sum: 1 },
            poseBannedCount: {
              $sum: { $cond: [{ $eq: ['$currentStatus', 'POSE_BANNED'] }, 1, 0] },
            },
            removedCount: {
              $sum: { $cond: [{ $eq: ['$currentStatus', 'REMOVED'] }, 1, 0] },
            },
            lastDropAt: { $max: '$detectedAt' },
            lastService: { $last: '$service' },
          },
        },
        { $sort: { dropCount: -1, lastDropAt: -1 } },
        { $limit: topN },
      ]),

      // Recent critical events (POSE_BANNED + REMOVED)
      MasternodeEvent.find({
        detectedAt: { $gte: since },
        currentStatus: { $in: dropStatuses },
      })
        .sort({ detectedAt: -1 })
        .limit(25)
        .lean(),

      // Status transition breakdown (all events in window)
      MasternodeEvent.aggregate([
        { $match: { detectedAt: { $gte: since } } },
        { $group: { _id: '$currentStatus', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      // All POSE_BANNED events in window (lightweight projection) for wave detection
      MasternodeEvent.find(
        { detectedAt: { $gte: since }, currentStatus: 'POSE_BANNED' },
        { nodeId: 1, service: 1, detectedAt: 1, _id: 0 },
      )
        .sort({ detectedAt: 1 })
        .lean(),
    ]);

    // Enrich offenders with current live data (status, country, payout, IP)
    const liveById = new Map(liveNodes.map((n) => [n.id, n]));
    const offenders = (offendersRaw as Array<{
      _id: string;
      dropCount: number;
      poseBannedCount: number;
      removedCount: number;
      lastDropAt: Date;
      lastService: string;
    }>).map((o) => {
      const live = liveById.get(o._id);
      return {
        nodeId: o._id,
        dropCount: o.dropCount,
        poseBannedCount: o.poseBannedCount,
        removedCount: o.removedCount,
        lastDropAt: toIsoDate(o.lastDropAt, 'lastDropAt'),
        lastService: o.lastService || live?.service || '',
        currentStatus: live?.status ?? 'UNKNOWN',
        countryCode: live?.countryCode ?? 'UNK',
        countryName: live?.countryName ?? 'Unknown',
        proTxHash: live?.proTxHash ?? null,
        payoutAddress: live?.payoutAddress ?? null,
        isCurrentlyDown: live ? !isActiveMasternodeStatus(live.status) : true,
        ip: live?.ip ?? null,
        provider: live?.provider ?? null,
        providerSource: live?.providerSource ?? null,
        providerTagCidr: live?.providerTagCidr ?? null,
        providerTagSource: live?.providerTagSource ?? null,
        providerConfidence: live?.providerConfidence ?? null,
        asn: live?.asn ?? null,
        asnOrg: live?.asnOrg ?? null,
      };
    });

    // Enrich recent critical events with current live provider/ip data
    const recentCriticalEnriched = (recentCritical as Array<Record<string, unknown> & { nodeId: string }>).map(
      (e) => {
        const live = liveById.get(e.nodeId);
        return serializeMasternodeEvent({
          ...e,
          ip: live?.ip ?? null,
          countryCode: live?.countryCode ?? 'UNK',
          countryName: live?.countryName ?? 'Unknown',
          provider: live?.provider ?? null,
          providerSource: live?.providerSource ?? null,
          providerTagCidr: live?.providerTagCidr ?? null,
          providerTagSource: live?.providerTagSource ?? null,
          providerConfidence: live?.providerConfidence ?? null,
          asn: live?.asn ?? null,
          asnOrg: live?.asnOrg ?? null,
        });
      },
    );

    // ─── Cluster analysis (operator pubkey / IP / /24 subnet) ──────────────
    function subnet24(ip: string | null): string | null {
      if (!ip) return null;
      const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.\d+$/);
      if (!m) return null; // IPv4 only
      return `${m[1]}.${m[2]}.${m[3]}.0/24`;
    }

    type ClusterNode = {
      nodeId: string;
      proTxHash: string | null;
      service: string;
      ip: string;
      status: string;
      countryCode: string;
      payoutAddress: string | null;
      provider: string | null;
      asn: number | null;
      asnOrg: string | null;
    };

    const operatorMap = new Map<string, ClusterNode[]>();
    const ipMap = new Map<string, ClusterNode[]>();
    const subnetMap = new Map<string, ClusterNode[]>();

    for (const n of liveNodes) {
      const cn: ClusterNode = {
        nodeId: n.id,
        proTxHash: n.proTxHash,
        service: n.service,
        ip: n.ip,
        status: n.status,
        countryCode: n.countryCode,
        payoutAddress: n.payoutAddress,
        provider: n.provider ?? null,
        asn: n.asn ?? null,
        asnOrg: n.asnOrg ?? null,
      };
      if (n.operatorPubkey) {
        const arr = operatorMap.get(n.operatorPubkey) ?? [];
        arr.push(cn);
        operatorMap.set(n.operatorPubkey, arr);
      }
      if (n.ip) {
        const arr = ipMap.get(n.ip) ?? [];
        arr.push(cn);
        ipMap.set(n.ip, arr);
      }
      const sub = subnet24(n.ip);
      if (sub) {
        const arr = subnetMap.get(sub) ?? [];
        arr.push(cn);
        subnetMap.set(sub, arr);
      }
    }

    function evidence(banned: number, totalNodes: number): 'weak' | 'moderate' | 'strong' | 'critical' {
      if (banned >= 3 || (banned >= 2 && totalNodes <= 4)) return 'critical';
      if (banned >= 2) return 'strong';
      if (banned >= 1 && totalNodes >= 2) return 'moderate';
      return 'weak';
    }

    function buildClusters(map: Map<string, ClusterNode[]>, minSize: number, requireBans = false) {
      return Array.from(map.entries())
        .filter(([, arr]) => arr.length >= minSize)
        .map(([key, nodes]) => {
          const banned = nodes.filter((x) => !isActiveMasternodeStatus(x.status)).length;
          // Compute dominant provider for the cluster
          const providerCounts = new Map<string, number>();
          for (const n of nodes) {
            const p = n.provider || 'Unknown';
            providerCounts.set(p, (providerCounts.get(p) || 0) + 1);
          }
          let dominantProvider: { name: string; count: number; share: number } | null = null;
          let topName = '';
          let topCount = 0;
          for (const [name, count] of providerCounts) {
            if (count > topCount) {
              topCount = count;
              topName = name;
            }
          }
          if (topName) {
            dominantProvider = {
              name: topName,
              count: topCount,
              share: Math.round((topCount / nodes.length) * 1000) / 10,
            };
          }
          return {
            key,
            totalNodes: nodes.length,
            bannedNodes: banned,
            evidence: evidence(banned, nodes.length),
            dominantProvider,
            nodes,
          };
        })
        .filter((c) => (requireBans ? c.bannedNodes >= 2 : true))
        .sort((a, b) => b.bannedNodes - a.bannedNodes || b.totalNodes - a.totalNodes)
        .slice(0, 25);
    }

    const operatorClusters = buildClusters(operatorMap, 2);
    const ipClusters = buildClusters(ipMap, 2);
    const subnetClusters = buildClusters(subnetMap, 4, true);

    let peerMetaByIp = new Map<string, PeerMeta>();
    try {
      peerMetaByIp = await getPeerMetaByIp();
    } catch {
      peerMetaByIp = new Map<string, PeerMeta>();
    }

    // ─── PoSe penalty watchlist (nodes approaching the ban threshold) ─────
    const poseWatchlist = liveNodes
      .filter((n) => n.posePenalty > 0 && n.status !== 'POSE_BANNED')
      .map((n) => {
        const peerMeta = peerMetaByIp.get(n.ip);
        return {
          nodeId: n.id,
          proTxHash: n.proTxHash,
          service: n.service,
          ip: n.ip,
          port: n.port,
          countryCode: n.countryCode,
          countryName: n.countryName,
          status: n.status,
          posePenalty: n.posePenalty,
          payoutAddress: n.payoutAddress,
          protocolVersion:
            peerMeta?.protocolVersion ??
            (typeof n.protocol === 'number' && n.protocol > 1000 ? n.protocol : null),
          walletVersion: peerMeta?.walletVersion ?? null,
          peerCount: peerMeta?.peerCount ?? null,
        };
      })
      .sort((a, b) => b.posePenalty - a.posePenalty)
      .slice(0, 50);

    // ─── PoSe ban wave detection (≥3 POSE_BANNED events within 30 min) ────
    const WAVE_WINDOW_SEC = 1800;
    const banEvents = (banEventsRaw as Array<{ nodeId: string; service: string; detectedAt: Date }>)
      .map((e) => ({
        nodeId: e.nodeId,
        service: e.service,
        at: new Date(e.detectedAt).getTime(),
      }));

    const banWaves: Array<{
      startedAt: string;
      windowSeconds: number;
      totalNodes: number;
      ips: string[];
      countries: string[];
      nodes: Array<{ nodeId: string; service: string; proTxHash: string | null; countryCode: string }>;
    }> = [];
    const usedKeys = new Set<string>();
    for (let i = 0; i < banEvents.length; i++) {
      const base = banEvents[i];
      const baseKey = `${base.nodeId}|${base.at}`;
      if (usedKeys.has(baseKey)) continue;
      const cluster: typeof banEvents = [base];
      for (let j = i + 1; j < banEvents.length; j++) {
        if ((banEvents[j].at - base.at) / 1000 > WAVE_WINDOW_SEC) break;
        cluster.push(banEvents[j]);
      }
      const uniqueByNode = new Map<string, (typeof banEvents)[number]>();
      for (const c of cluster) uniqueByNode.set(c.nodeId, c);
      const unique = Array.from(uniqueByNode.values());
      if (unique.length >= 3) {
        const ips = new Set<string>();
        const countries = new Set<string>();
        const nodesEnriched = unique.map((u) => {
          const live = liveById.get(u.nodeId);
          if (live?.ip) ips.add(live.ip);
          if (live?.countryCode) countries.add(live.countryCode);
          return {
            nodeId: u.nodeId,
            service: u.service || live?.service || '',
            proTxHash: live?.proTxHash ?? null,
            countryCode: live?.countryCode ?? 'UNK',
          };
        });
        banWaves.push({
          startedAt: new Date(base.at).toISOString(),
          windowSeconds: WAVE_WINDOW_SEC,
          totalNodes: unique.length,
          ips: Array.from(ips).sort(),
          countries: Array.from(countries).sort(),
          nodes: nodesEnriched,
        });
        for (const c of cluster) usedKeys.add(`${c.nodeId}|${c.at}`);
      }
    }
    banWaves.sort((a, b) => b.totalNodes - a.totalNodes);

    // Build a deterministic timeline array (zero-fill empty buckets)
    const bucketMs = bucket === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const timelineMap = new Map<string, { poseBanned: number; removed: number }>();
    for (const row of timelineRaw as Array<{
      _id: { bucket: string; status: string };
      count: number;
    }>) {
      const key = row._id.bucket;
      const entry = timelineMap.get(key) ?? { poseBanned: 0, removed: 0 };
      if (row._id.status === 'POSE_BANNED') entry.poseBanned += row.count;
      if (row._id.status === 'REMOVED') entry.removed += row.count;
      timelineMap.set(key, entry);
    }

    const timeline: Array<{
      bucket: string;
      timestamp: number;
      poseBanned: number;
      removed: number;
      total: number;
    }> = [];
    const startTime = Math.floor(since.getTime() / bucketMs) * bucketMs;
    const endTime = Date.now();
    for (let t = startTime; t <= endTime; t += bucketMs) {
      const d = new Date(t);
      const key =
        bucket === 'hour'
          ? d.toISOString().slice(0, 13) + ':00:00Z'
          : d.toISOString().slice(0, 10);
      const entry = timelineMap.get(key) ?? { poseBanned: 0, removed: 0 };
      timeline.push({
        bucket: key,
        timestamp: Math.floor(t / 1000),
        poseBanned: entry.poseBanned,
        removed: entry.removed,
        total: entry.poseBanned + entry.removed,
      });
    }

    const payload = masternodeHealthApiResponseSchema.parse({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        windowHours: hours,
        bucket,
        rpcAvailable,
        snapshot: {
          total,
          enabled,
          poseBanned,
          posePenalty,
          new: statusCounts.NEW ?? 0,
          other: total - enabled - poseBanned - (statusCounts.NEW ?? 0),
          withPoseBanHeight,
          healthScore,
          statusCounts,
        },
        timeline,
        offenders,
        recentEvents: recentCriticalEnriched,
        statusBreakdown: (statusBreakdown as Array<{ _id: string; count: number }>).map((s) => ({
          status: s._id,
          count: s.count,
        })),
        clusters: {
          operator: operatorClusters,
          ip: ipClusters,
          subnet: subnetClusters,
        },
        poseWatchlist,
        banWaves,
      },
    });
    setAnalyticsCache(cacheKey, payload);
    (inFlightResolve as ((payload: CachedAnalyticsPayload) => void) | null)?.(payload);
    res.json(payload);
  } catch (error) {
    (inFlightReject as ((reason?: unknown) => void) | null)?.(error);
    if (staleCached) {
      return res.json(staleCached);
    }
    sendInternalError(res, 'Failed to compute masternode health', error);
  } finally {
    if (inFlightRegistered && cacheKey) {
      analyticsInFlight.delete(cacheKey);
    }
  }
});

/**
 * GET /api/v1/masternodes/ban-waves
 * Detailed ban-wave analysis with timeline, scatter, country breakdown
 * and tunable detection parameters.
 *
 * Query params:
 *   - hours:         1..2160 (default 168 = 7 days, max 90 days)
 *   - windowMinutes: 5..120 (default 30) - sliding window for wave grouping
 *   - minNodes:      2..50 (default 3) - minimum unique nodes to qualify as wave
 *   - bucket:        'auto' | '15min' | 'hour' | 'day' (default auto)
 */
router.get('/ban-waves', withCachePolicy('no-store'), async (req: Request, res: Response) => {
  let inFlightResolve: ((payload: CachedAnalyticsPayload) => void) | null = null;
  let inFlightReject: ((reason?: unknown) => void) | null = null;
  let inFlightRegistered = false;
  let cacheKey = '';
  let staleCached: CachedAnalyticsPayload | null = null;
  try {
    const hours = Math.min(
      Math.max(parseInt(String(req.query.hours ?? '168'), 10) || 168, 1),
      2160,
    );
    const windowMinutes = Math.min(
      Math.max(parseInt(String(req.query.windowMinutes ?? '30'), 10) || 30, 5),
      120,
    );
    const minNodes = Math.min(
      Math.max(parseInt(String(req.query.minNodes ?? '3'), 10) || 3, 2),
      50,
    );
    let bucket = String(req.query.bucket ?? 'auto');
    if (!['auto', '15min', 'hour', 'day'].includes(bucket)) bucket = 'auto';
    if (bucket === 'auto') {
      if (hours <= 24) bucket = '15min';
      else if (hours <= 168) bucket = 'hour';
      else bucket = 'day';
    }
    cacheKey = `ban-waves:${hours}:${windowMinutes}:${minNodes}:${bucket}`;
    const cached = getAnalyticsCache(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    staleCached = getAnalyticsStaleCache(cacheKey);

    const existingInFlight = analyticsInFlight.get(cacheKey);
    if (existingInFlight) {
      try {
        const payload = await existingInFlight;
        return res.json(payload);
      } catch {
        if (staleCached) {
          return res.json(staleCached);
        }
        throw new Error('ban-waves in-flight query failed');
      }
    }

    const inFlightPromise = new Promise<CachedAnalyticsPayload>((resolve, reject) => {
      inFlightResolve = resolve;
      inFlightReject = reject;
    });
    analyticsInFlight.set(cacheKey, inFlightPromise);
    inFlightRegistered = true;

    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const windowSec = windowMinutes * 60;

    // Try to load live nodes for enrichment (country, IP, operator, payout)
    let liveNodes: Awaited<ReturnType<typeof getEnrichedNodes>> = [];
    let liveById = new Map<string, Awaited<ReturnType<typeof getEnrichedNodes>>[number]>();
    let rpcAvailable = true;
    try {
      liveNodes = await getEnrichedNodes();
      liveById = new Map(liveNodes.map((n) => [n.id, n]));
    } catch {
      rpcAvailable = false;
    }

    const nowMs = Date.now();
    const freshSinceMs = nowMs - 24 * 60 * 60 * 1000;
    const statusCounts = liveNodes.reduce<Record<string, number>>((acc, node) => {
      acc[node.status] = (acc[node.status] ?? 0) + 1;
      return acc;
    }, {});
    const currentPoseBanned = statusCounts.POSE_BANNED ?? 0;
    const currentPosePenalty = statusCounts.POSE_PENALTY ?? 0;
    const currentValid = (statusCounts.ENABLED ?? 0) + currentPosePenalty;
    const registeredTotal = liveNodes.length;

    function banIdentity(node: Awaited<ReturnType<typeof getEnrichedNodes>>[number]): string {
      return node.proTxHash || node.id;
    }

    const liveByIdentity = new Map<string, Awaited<ReturnType<typeof getEnrichedNodes>>[number]>();
    for (const node of liveNodes) liveByIdentity.set(banIdentity(node), node);

    const historicalRaw = await MasternodeEvent.find(
      { detectedAt: { $gte: since }, eventType: 'ban' },
      {
        nodeId: 1,
        service: 1,
        previousStatus: 1,
        currentStatus: 1,
        detectedAt: 1,
        eventStatus: 1,
        proTxHash: 1,
        ip: 1,
        countryCode: 1,
        countryName: 1,
        operatorPubkey: 1,
        payoutAddress: 1,
        provider: 1,
        providerSource: 1,
        providerTagCidr: 1,
        providerTagSource: 1,
        providerConfidence: 1,
        asn: 1,
        asnOrg: 1,
        poseBanHeight: 1,
        detectedHeight: 1,
        recoveredAt: 1,
        recoveredHeight: 1,
        recoveryTransition: 1,
        _id: 0,
      },
    )
      .sort({ detectedAt: 1 })
      .lean();

    let poseBanHeightEvents: HistoricalBanEvent[] = (
      historicalRaw as Array<Record<string, unknown>>
    ).map((event) => {
      const nodeId = String(event.nodeId || '');
      const proTxHash = typeof event.proTxHash === 'string' ? event.proTxHash : '';
      const live = liveByIdentity.get(proTxHash || nodeId) || liveById.get(nodeId);
      return mapStoredBanEvent(event, live);
    });

    // If the append-only history is not seeded yet (e.g. immediately after deploy),
    // keep the endpoint useful by falling back to current PoSeBanHeight observations.
    if (poseBanHeightEvents.length === 0 && liveNodes.length > 0) {
      poseBanHeightEvents = liveNodes
        .filter((node) => node.status === 'POSE_BANNED' && typeof node.poseBanAt === 'number')
        .map((node) => ({
          nodeId: node.id,
          service: node.service,
          previousStatus: 'POSE_BAN_HEIGHT',
          currentStatus: 'POSE_BANNED',
          at: Number(node.poseBanAt) * 1000,
          dedupeId: banIdentity(node),
          proTxHash: node.proTxHash ?? null,
          ip: node.ip ?? '',
          countryCode: node.countryCode ?? 'UNK',
          countryName: node.countryName ?? 'Unknown',
          operatorPubkey: node.operatorPubkey ?? null,
          payoutAddress: node.payoutAddress ?? null,
          provider: node.provider ?? null,
          providerSource: node.providerSource ?? null,
          providerTagCidr: node.providerTagCidr ?? null,
          providerTagSource: node.providerTagSource ?? null,
          providerConfidence: node.providerConfidence ?? null,
          asn: node.asn ?? null,
          asnOrg: node.asnOrg ?? null,
          poseBanHeight: node.poseBanHeight ?? null,
          detectedHeight: node.poseBanHeight ?? null,
          recoveredAt: null,
          recoveredHeight: null,
          recoveryTransition: null,
          eventStatus: 'banned' as const,
        }))
        .filter((event) => Number.isFinite(event.at) && event.at >= since.getTime())
        .sort((a, b) => a.at - b.at);
    }

    // Version detection is persisted by the inventory scanner. Historical ban
    // events keep their original IP, so this lookup can enrich recovered nodes
    // too, without relying on whether they are currently connected as peers.
    const inventoryByIp = new Map<
      string,
      { walletVersion: string | null; protocolVersion: number | null; lastObservedAt: Date | null }
    >();
    const eventIps = Array.from(new Set(poseBanHeightEvents.map((event) => event.ip).filter(Boolean)));
    if (eventIps.length > 0) {
      const inventoryRows = await NodeInventory.find(
        { ip: { $in: eventIps } },
        { ip: 1, walletVersion: 1, protocolVersion: 1, lastObservedAt: 1 }
      ).lean();
      for (const row of inventoryRows) {
        const current = inventoryByIp.get(row.ip);
        const currentAt = current?.lastObservedAt ? new Date(current.lastObservedAt).getTime() : 0;
        const rowAt = row.lastObservedAt ? new Date(row.lastObservedAt).getTime() : 0;
        if (!current || rowAt >= currentAt) {
          inventoryByIp.set(row.ip, {
            walletVersion: row.walletVersion ?? null,
            protocolVersion: row.protocolVersion ?? null,
            lastObservedAt: row.lastObservedAt ?? null,
          });
        }
      }
    }

    const classifiedEvents = classifyHistoricalBanEvents(poseBanHeightEvents, {
      freshSinceMs,
      windowSinceMs: since.getTime(),
    });
    const {
      freshBanEvents,
      recoveryEvents,
      stillBannedEvents,
      observedAlreadyBannedEvents,
      observedAlreadyBanned24hEvents,
      freshDrops24h,
      freshDropEvents24h,
    } = classifiedEvents;
    const totalBans = poseBanHeightEvents.length;
    const uniqueBannedNodes = new Set(poseBanHeightEvents.map((e) => e.dedupeId)).size;

    // ─── Detect waves (sliding window) ───────────────────────────────────────
    const waves = buildBanWaves<BanWavePresentationNode>(poseBanHeightEvents, {
      windowSeconds: windowSec,
      minNodes,
      toWaveNode: (u) => {
        const live = liveByIdentity.get(u.dedupeId) || liveById.get(u.nodeId);
        const inventory = inventoryByIp.get(u.ip || live?.ip || '');
        return mapBanWaveNode(u, live, inventory);
      },
    });

    // ─── Timeline (zero-filled buckets, with cumulative + waveBans split) ────
    const bucketMs =
      bucket === '15min' ? 15 * 60 * 1000 : bucket === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    function bucketKey(ms: number): string {
      const d = new Date(ms);
      if (bucket === 'day') return d.toISOString().slice(0, 10);
      if (bucket === 'hour') return d.toISOString().slice(0, 13) + ':00:00Z';
      // 15min
      const m = d.getUTCMinutes();
      const floor = Math.floor(m / 15) * 15;
      return d.toISOString().slice(0, 13) + `:${String(floor).padStart(2, '0')}:00Z`;
    }

    // Mark exact events that belong to a wave for split coloring.
    const waveEventKeys = new Set<string>();
    for (const w of waves) {
      for (const n of w.nodes) {
        waveEventKeys.add(`${n.proTxHash || n.nodeId}|${new Date(n.atIso).getTime()}`);
      }
    }

    const startBucket = Math.floor(since.getTime() / bucketMs) * bucketMs;
    const endBucket = Date.now();
    type TimelinePoint = {
      bucket: string;
      timestamp: number;
      waveBans: number;
      isolatedBans: number;
      recovered: number;
      stillBanned: number;
      total: number;
      cumulative: number;
    };

    function buildDropTimeline(events: HistoricalBanEvent[]): TimelinePoint[] {
      const tlMap = new Map<string, { wave: number; isolated: number; recovered: number; stillBanned: number }>();
      for (const e of events) {
        const key = bucketKey(e.at);
        const slot = tlMap.get(key) ?? { wave: 0, isolated: 0, recovered: 0, stillBanned: 0 };
        if (waveEventKeys.has(`${banEventIdentity(e)}|${e.at}`)) slot.wave += 1;
        else slot.isolated += 1;
        if (e.eventStatus === 'recovered') slot.recovered += 1;
        else slot.stillBanned += 1;
        tlMap.set(key, slot);
      }

      let cumulative = 0;
      const rows: TimelinePoint[] = [];
      for (let t = startBucket; t <= endBucket; t += bucketMs) {
        const key = bucketKey(t);
        const slot = tlMap.get(key) ?? { wave: 0, isolated: 0, recovered: 0, stillBanned: 0 };
        const tot = slot.wave + slot.isolated;
        cumulative += tot;
        rows.push({
          bucket: key,
          timestamp: Math.floor(t / 1000),
          waveBans: slot.wave,
          isolatedBans: slot.isolated,
          recovered: slot.recovered,
          stillBanned: slot.stillBanned,
          total: tot,
          cumulative,
        });
      }
      return rows;
    }

    function buildRecoveryTimeline(events: HistoricalBanEvent[]): TimelinePoint[] {
      const tlMap = new Map<string, number>();
      for (const e of events) {
        if (e.recoveredAt == null) continue;
        const key = bucketKey(e.recoveredAt);
        tlMap.set(key, (tlMap.get(key) ?? 0) + 1);
      }
      let cumulative = 0;
      const rows: TimelinePoint[] = [];
      for (let t = startBucket; t <= endBucket; t += bucketMs) {
        const key = bucketKey(t);
        const recovered = tlMap.get(key) ?? 0;
        cumulative += recovered;
        rows.push({
          bucket: key,
          timestamp: Math.floor(t / 1000),
          waveBans: 0,
          isolatedBans: 0,
          recovered,
          stillBanned: 0,
          total: recovered,
          cumulative,
        });
      }
      return rows;
    }

    const timeline = buildDropTimeline(freshBanEvents);
    const allTrackedTimeline = buildDropTimeline(poseBanHeightEvents);
    const recoveredTimeline = buildRecoveryTimeline(recoveryEvents);
    const stillBannedTimeline = buildDropTimeline(stillBannedEvents);

    const severityRank: Record<BanWaveSeverity, number> = {
      low: 1,
      moderate: 2,
      high: 3,
      critical: 4,
    };

    const waveBands: Array<{ x1: string; x2: string; severity: BanWaveSeverity }> = [];
    const waveBandTimeline = allTrackedTimeline.length > 0 ? allTrackedTimeline : timeline;
    if (waveBandTimeline.length > 0) {
      const bucketTimesMs = waveBandTimeline.map((point) => point.timestamp * 1000);
      const firstBucketMs = bucketTimesMs[0];
      const lastBucketMs = bucketTimesMs[bucketTimesMs.length - 1];

      const findLastIndexLE = (value: number) => {
        let lo = 0;
        let hi = bucketTimesMs.length - 1;
        let ans = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (bucketTimesMs[mid] <= value) {
            ans = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        return ans;
      };

      const findFirstIndexGE = (value: number) => {
        let lo = 0;
        let hi = bucketTimesMs.length - 1;
        let ans = bucketTimesMs.length - 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (bucketTimesMs[mid] >= value) {
            ans = mid;
            hi = mid - 1;
          } else {
            lo = mid + 1;
          }
        }
        return ans;
      };

      const rawBands: Array<{ start: number; end: number; severity: BanWaveSeverity }> = [];
      for (const wave of waves) {
        const startMs = new Date(wave.startedAt).getTime();
        const endMs = new Date(wave.endedAt).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
        if (endMs < firstBucketMs || startMs > lastBucketMs) continue;

        const start = findLastIndexLE(startMs);
        const end = findFirstIndexGE(endMs);
        if (end < start) continue;
        rawBands.push({ start, end, severity: wave.severity });
      }

      rawBands.sort((a, b) => a.start - b.start);
      const mergedBands: Array<{ start: number; end: number; severity: BanWaveSeverity }> = [];
      for (const band of rawBands) {
        const last = mergedBands[mergedBands.length - 1];
        if (!last || band.start > last.end + 1) {
          mergedBands.push({ ...band });
          continue;
        }
        last.end = Math.max(last.end, band.end);
        if (severityRank[band.severity] > severityRank[last.severity]) {
          last.severity = band.severity;
        }
      }

      for (const band of mergedBands) {
        waveBands.push({
          x1: waveBandTimeline[band.start]?.bucket ?? waveBandTimeline[0].bucket,
          x2: waveBandTimeline[band.end]?.bucket ?? waveBandTimeline[waveBandTimeline.length - 1].bucket,
          severity: band.severity,
        });
      }
    }

    // ─── Country breakdown (top 15) ──────────────────────────────────────────
    const countryMap = new Map<string, { code: string; name: string; wave: number; isolated: number }>();
    for (const e of poseBanHeightEvents) {
      const live = liveByIdentity.get(e.dedupeId) || liveById.get(e.nodeId);
      const code = e.countryCode || live?.countryCode || 'UNK';
      const name = e.countryName || live?.countryName || 'Unknown';
      const slot = countryMap.get(code) ?? { code, name, wave: 0, isolated: 0 };
      if (waveEventKeys.has(`${e.dedupeId}|${e.at}`)) slot.wave += 1;
      else slot.isolated += 1;
      countryMap.set(code, slot);
    }
    const countryBreakdown = Array.from(countryMap.values())
      .map((c) => ({ ...c, total: c.wave + c.isolated }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    const providerMap = new Map<
      string,
      { provider: string; wave: number; isolated: number; tagged: number; auto: number }
    >();
    const sourceMap = new Map<string, number>();
    for (const e of poseBanHeightEvents) {
      const live = liveByIdentity.get(e.dedupeId) || liveById.get(e.nodeId);
      const provider = e.provider || live?.provider || 'Unknown';
      const source = e.providerSource || live?.providerSource || 'unknown';
      const slot = providerMap.get(provider) ?? {
        provider,
        wave: 0,
        isolated: 0,
        tagged: 0,
        auto: 0,
      };
      if (waveEventKeys.has(`${e.dedupeId}|${e.at}`)) slot.wave += 1;
      else slot.isolated += 1;
      if (source === 'tag') slot.tagged += 1;
      else slot.auto += 1;
      providerMap.set(provider, slot);
      sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
    }

    const providerBreakdown = Array.from(providerMap.values())
      .map((entry) => ({
        ...entry,
        total: entry.wave + entry.isolated,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    const providerSourceBreakdown = Array.from(sourceMap.entries())
      .map(([source, count]) => ({
        source,
        count,
        sharePct: totalBans > 0 ? Math.round((count / totalBans) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const nodeBanCount = new Map<string, number>();
    for (const e of poseBanHeightEvents) {
      nodeBanCount.set(e.dedupeId, (nodeBanCount.get(e.dedupeId) ?? 0) + 1);
    }

    const reliabilityCohorts = {
      totalLiveNodes: liveNodes.length,
      never: 0,
      once: 0,
      repeat2to3: 0,
      repeat4plus: 0,
    };

    type ProviderReliabilitySlot = {
      provider: string;
      totalNodes: number;
      never: number;
      once: number;
      repeat2to3: number;
      repeat4plus: number;
    };

    const providerReliabilityMap = new Map<string, ProviderReliabilitySlot>();
    for (const live of liveNodes) {
      const provider = live.provider || 'Unknown';
      const slot = providerReliabilityMap.get(provider) ?? {
        provider,
        totalNodes: 0,
        never: 0,
        once: 0,
        repeat2to3: 0,
        repeat4plus: 0,
      };
      slot.totalNodes += 1;

      const bans = nodeBanCount.get(banIdentity(live)) ?? 0;
      if (bans === 0) {
        reliabilityCohorts.never += 1;
        slot.never += 1;
      } else if (bans === 1) {
        reliabilityCohorts.once += 1;
        slot.once += 1;
      } else if (bans <= 3) {
        reliabilityCohorts.repeat2to3 += 1;
        slot.repeat2to3 += 1;
      } else {
        reliabilityCohorts.repeat4plus += 1;
        slot.repeat4plus += 1;
      }

      providerReliabilityMap.set(provider, slot);
    }

    const providerReliability = Array.from(providerReliabilityMap.values())
      .map((entry) => {
        const repeated = entry.repeat2to3 + entry.repeat4plus;
        return {
          ...entry,
          repeated,
          repeatedPct:
            entry.totalNodes > 0 ? Math.round((repeated / entry.totalNodes) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => {
        if (b.totalNodes !== a.totalNodes) return b.totalNodes - a.totalNodes;
        if (b.repeated !== a.repeated) return b.repeated - a.repeated;
        return b.repeatedPct - a.repeatedPct;
      })
      .slice(0, 12);

    // ─── Inter-wave gaps + KPIs ──────────────────────────────────────────────
    let largestWave = 0;
    let nodesInWaves = 0;
    for (const w of waves) {
      if (w.totalNodes > largestWave) largestWave = w.totalNodes;
      nodesInWaves += w.totalNodes;
    }
    const freshWaves24h = waves.filter((wave) => new Date(wave.startedAt).getTime() >= freshSinceMs);
    const freshWaveCount24h = freshWaves24h.length;
    const freshNodesInWaves24h = freshWaves24h.reduce((sum, wave) => sum + wave.totalNodes, 0);
    const freshLargestWave24h = freshWaves24h.reduce((max, wave) => Math.max(max, wave.totalNodes), 0);

    let mtbwSec: number | null = null;
    if (freshWaves24h.length >= 2) {
      // Fresh waves are desc-sorted; convert to asc for gap calc.
      const asc = [...freshWaves24h].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      );
      let total = 0;
      for (let i = 1; i < asc.length; i++) {
        total +=
          (new Date(asc[i].startedAt).getTime() - new Date(asc[i - 1].startedAt).getTime()) / 1000;
      }
      mtbwSec = Math.round(total / (asc.length - 1));
    }
    const allCountries = new Set<string>();
    for (const e of poseBanHeightEvents) {
      const live = liveByIdentity.get(e.dedupeId) || liveById.get(e.nodeId);
      const code = e.countryCode || live?.countryCode;
      if (code && code !== 'UNK') allCountries.add(code);
    }

    const payload = banWaveAnalysisApiResponseSchema.parse({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        windowHours: hours,
        windowMinutes,
        minNodes,
        bucket,
        rpcAvailable,
        currentPoseBanned,
        currentPosePenalty,
        currentValid,
        registeredTotal,
        freshDrops24h,
        freshDropEvents24h,
        observedAlreadyBanned24h: observedAlreadyBanned24hEvents.length,
        kpis: {
          totalBans,
          uniqueBannedNodes,
          waveCount: freshWaveCount24h,
          windowWaveCount: waves.length,
          nodesInWaves: freshNodesInWaves24h,
          windowNodesInWaves: nodesInWaves,
          largestWave: freshLargestWave24h,
          windowLargestWave: largestWave,
          freshDrops24h,
          freshDropEvents24h,
          observedAlreadyBanned24h: observedAlreadyBanned24hEvents.length,
          currentPoseBanned,
          currentPosePenalty,
          currentValid,
          registeredTotal,
          uniqueCountries: allCountries.size,
          meanTimeBetweenWavesSec: mtbwSec,
        },
        timeline,
        timelineModes: {
          fresh: timeline,
          recovered: recoveredTimeline,
          still: stillBannedTimeline,
          all: allTrackedTimeline,
        },
        eventBreakdown: {
          freshBans: freshDrops24h,
          freshDropEvents24h,
          allBanEvents: poseBanHeightEvents.length,
          historicalDropEvents: poseBanHeightEvents.length,
          recoveredEvents: recoveryEvents.length,
          stillBannedEvents: stillBannedEvents.length,
          poseBanHeightEvents: poseBanHeightEvents.length,
          observedAlreadyBanned: observedAlreadyBannedEvents.length,
          observedAlreadyBanned24h: observedAlreadyBanned24hEvents.length,
          enabledToBanned: poseBanHeightEvents.filter((e) => e.previousStatus === 'ENABLED').length,
          penaltyToBanned: poseBanHeightEvents.filter((e) => e.previousStatus === 'POSE_PENALTY').length,
          uniqueFreshNodes: freshDrops24h,
          uniqueAllNodes: new Set(poseBanHeightEvents.map((e) => e.dedupeId)).size,
        },
        waveBands,
        countryBreakdown,
        providerBreakdown,
        providerSourceBreakdown,
        reliabilityCohorts,
        providerReliability,
        waves,
      },
    });
    setAnalyticsCache(cacheKey, payload);
    (inFlightResolve as ((payload: CachedAnalyticsPayload) => void) | null)?.(payload);
    res.json(payload);
  } catch (error) {
    (inFlightReject as ((reason?: unknown) => void) | null)?.(error);
    if (staleCached) {
      return res.json(staleCached);
    }
    sendInternalError(res, 'Failed to compute ban waves', error);
  } finally {
    if (inFlightRegistered && cacheKey) {
      analyticsInFlight.delete(cacheKey);
    }
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Per-node routes
// ───────────────────────────────────────────────────────────────────────────────

router.get('/:id', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const paramParsed = masternodeIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(paramParsed.error));
    }
    const { id } = paramParsed.data;

    let nodes;
    try {
      nodes = await getEnrichedNodes();
    } catch (error) {
      return sendServiceUnavailable(res, 'Could not fetch masternodes from daemon RPC', error);
    }

    const node = nodes.find((n) => n.id === id || n.proTxHash === id);
    if (!node) {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Masternode not found' } });
    }

    // Calculate queue position and next payout ETA
    const enabledNodes = nodes.filter((n) => isActiveMasternodeStatus(n.status));
    const sorted = [...enabledNodes].sort((a, b) => {
      const aReg = a.registeredAt ?? Infinity;
      const bReg = b.registeredAt ?? Infinity;
      return aReg - bReg;
    });
    const queuePosition = sorted.findIndex((n) => n.id === node.id);
    const avgBlockTime = COIN.BLOCK_TIME_SECONDS;
    const nextPayoutEta =
      queuePosition >= 0 && enabledNodes.length > 0
        ? Math.round(queuePosition * avgBlockTime)
        : null;

    res.json({
      success: true,
      data: {
        ...node,
        uptime: node.activeSeconds,
        queuePosition: queuePosition >= 0 ? queuePosition + 1 : null,
        nextPayoutEta,
      },
    });
  } catch (error) {
    sendInternalError(res, 'Failed to fetch masternode', error);
  }
});

router.get('/:id/events', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const paramParsed = masternodeIdParamSchema.safeParse(req.params);
    if (!paramParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(paramParsed.error));
    }
    const { id } = paramParsed.data;

    const limitParsed = parseV1EventsLimit(req.query as Record<string, unknown>, 50);
    if (!limitParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(limitParsed.error));
    }
    const { limit } = limitParsed.data;

    // Also match by proTxHash: find the canonical nodeId first
    let nodeId = id;
    try {
      const nodes = await getEnrichedNodes();
      const match = nodes.find((n) => n.id === id || n.proTxHash === id);
      if (match) nodeId = match.id;
    } catch {
      // If RPC is down, just search by the raw id
    }

    const events = await MasternodeEvent.find({ nodeId })
      .sort({ detectedAt: -1 })
      .limit(limit)
      .lean();

    res.json({ success: true, data: events });
  } catch (error) {
    sendInternalError(res, 'Failed to fetch masternode events', error);
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Bulk PoSe ban / recovery dataset export (for offline / AI analysis)
// ───────────────────────────────────────────────────────────────────────────────

const BAN_EXPORT_FIELDS = [
  'detectedAt', 'eventType', 'eventStatus', 'previousStatus', 'currentStatus',
  'nodeId', 'service', 'proTxHash', 'ip', 'port',
  'provider', 'providerSource', 'providerTagCidr', 'countryCode', 'countryName',
  'operatorPubkey', 'payoutAddress',
  'poseBanHeight', 'detectedHeight', 'recoveredAt', 'recoveredHeight', 'recoveryTransition',
] as const;

const BAN_EXPORT_MAX = 100_000;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pickBanFields(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of BAN_EXPORT_FIELDS) {
    const value = doc[field];
    out[field] = value instanceof Date ? value.toISOString() : (value ?? null);
  }
  return out;
}

function buildBanFilter(type: string, since: number | null): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    $or: [
      { eventType: 'ban' },
      { eventStatus: { $in: ['banned', 'recovered'] } },
      { poseBanHeight: { $ne: null } },
      { recoveredAt: { $ne: null } },
      { currentStatus: { $in: ['POSE_BANNED', 'POSE_PENALTY'] } },
    ],
  };
  // Recovery events are marked by eventStatus 'recovered' (there is no 'recovery' eventType).
  if (type === 'ban') filter.$and = [{ $or: [{ eventType: 'ban' }, { eventStatus: 'banned' }] }];
  else if (type === 'recovery') filter.$and = [{ $or: [{ eventStatus: 'recovered' }, { recoveredAt: { $ne: null } }] }];
  if (since !== null) filter.poseBanHeight = { $gte: since };
  return filter;
}

/**
 * GET /api/v1/masternodes/bans/export
 * Full PoSe ban / recovery dataset. Read-only public export for AI / offline analysis.
 *
 * Query params:
 *   - format: ndjson (default) | csv | json
 *   - type:   all (default) | ban | recovery
 *   - since:  optional minimum poseBanHeight (inclusive)
 *
 * Field dictionary: GET /api/v1/masternodes/bans/schema
 */
router.get('/bans/export', async (req: Request, res: Response) => {
  try {
    const format = (typeof req.query.format === 'string' ? req.query.format : 'ndjson').toLowerCase();
    const type = (typeof req.query.type === 'string' ? req.query.type : 'all').toLowerCase();
    const sinceRaw = parseInt(String(req.query.since ?? ''), 10);
    const since = Number.isFinite(sinceRaw) ? sinceRaw : null;
    const limitRaw = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, BAN_EXPORT_MAX) : BAN_EXPORT_MAX;

    const filter = buildBanFilter(type, since);

    const docs = (await MasternodeEvent.find(filter)
      .sort({ detectedAt: 1 })
      .limit(limit)
      .lean()) as Array<Record<string, unknown>>;

    res.setHeader('Cache-Control', 'public, max-age=300');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="defcon-pose-bans.csv"');
      const lines = [BAN_EXPORT_FIELDS.join(',')];
      for (const doc of docs) {
        const row = pickBanFields(doc);
        lines.push(BAN_EXPORT_FIELDS.map((field) => csvCell(row[field])).join(','));
      }
      return res.send(lines.join('\r\n') + '\r\n');
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="defcon-pose-bans.json"');
      return res.json({ success: true, count: docs.length, fields: BAN_EXPORT_FIELDS, events: docs.map(pickBanFields) });
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="defcon-pose-bans.ndjson"');
    const body = docs.map((doc) => JSON.stringify(pickBanFields(doc))).join('\n');
    return res.send(body + (docs.length ? '\n' : ''));
  } catch (error) {
    sendInternalError(res, 'Failed to export PoSe ban dataset', error);
  }
});

/**
 * GET /api/v1/masternodes/bans/schema
 * Field dictionary for the ban export, so AI tools can interpret the columns.
 */
router.get('/bans/schema', withCachePolicy('long'), (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      description: 'DeFCoN PoSe ban / recovery events. Append-only; one row per detected status transition.',
      endpoint: '/api/v1/masternodes/bans/export?format=ndjson|csv|json&type=all|ban|recovery&since=<height>',
      fields: {
        detectedAt: 'ISO timestamp the event was recorded',
        eventType: 'ban | recovery | status',
        eventStatus: 'banned | recovered | observed',
        previousStatus: 'MN status before this event',
        currentStatus: 'MN status after this event (e.g. POSE_BANNED, ENABLED, POSE_PENALTY, REMOVED)',
        nodeId: 'canonical node id (collateral outpoint)',
        service: 'ip:port service string',
        proTxHash: 'ProRegTx hash (masternode identity)',
        ip: 'service IP address',
        port: 'service port',
        provider: 'hosting provider label',
        providerSource: 'how the provider label was attributed',
        providerTagCidr: 'matched provider CIDR block',
        countryCode: 'ISO country code',
        countryName: 'country name',
        operatorPubkey: 'BLS operator public key',
        payoutAddress: 'masternode payout address',
        poseBanHeight: 'block height of the PoSe ban',
        detectedHeight: 'chain height when the event was detected',
        recoveredAt: 'ISO timestamp of recovery (null if still banned)',
        recoveredHeight: 'block height of recovery',
        recoveryTransition: 'status transition string on recovery',
      },
      notes: 'Public read-only data. Current-state totals and append-only event history are separate datasets and can differ slightly at the instant of collection.',
    },
  });
});

/**
 * GET /api/v1/masternodes/bans/stats
 * Pre-aggregated PoSe ban analytics (provider / country / payout-operator concentration,
 * largest exact-height ban waves). Ideal for AI/MCP summaries without downloading raw rows.
 *
 * Query params:
 *   - since: optional minimum poseBanHeight (inclusive)
 */
router.get('/bans/stats', withCachePolicy('medium'), async (req: Request, res: Response) => {
  try {
    const sinceRaw = parseInt(String(req.query.since ?? ''), 10);
    const since = Number.isFinite(sinceRaw) ? sinceRaw : null;
    const match = buildBanFilter('all', since);

    const topN = (field: string): PipelineStage.FacetPipelineStage[] => [
      { $match: { [field]: { $nin: [null, ''] } } },
      { $group: { _id: `$${field}`, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 15 },
      { $project: { _id: 0, value: '$_id', count: 1 } },
    ];

    const pipeline: PipelineStage[] = [
      { $match: match },
      {
        $facet: {
          total: [{ $count: 'n' }],
          bans: [{ $match: { $or: [{ eventType: 'ban' }, { eventStatus: 'banned' }] } }, { $count: 'n' }],
          recoveries: [{ $match: { $or: [{ eventStatus: 'recovered' }, { recoveredAt: { $ne: null } }] } }, { $count: 'n' }],
          byProvider: topN('provider'),
          byCountry: topN('countryName'),
          byPayoutOperator: topN('payoutAddress'),
          topWaves: [
            { $match: { poseBanHeight: { $ne: null } } },
            { $group: { _id: '$poseBanHeight', nodes: { $sum: 1 } } },
            { $sort: { nodes: -1 } },
            { $limit: 15 },
            { $project: { _id: 0, poseBanHeight: '$_id', nodes: 1 } },
          ],
        },
      },
    ];

    const [facet] = (await MasternodeEvent.aggregate(pipeline)) as Array<
      Record<string, Array<Record<string, unknown>>>
    >;

    const first = (arr: Array<Record<string, unknown>> | undefined) =>
      Array.isArray(arr) && arr[0] && typeof arr[0].n === 'number' ? (arr[0].n as number) : 0;

    res.json({
      success: true,
      data: {
        totalEvents: first(facet?.total),
        banEvents: first(facet?.bans),
        recoveryEvents: first(facet?.recoveries),
        topProviders: facet?.byProvider ?? [],
        topCountries: facet?.byCountry ?? [],
        topPayoutOperators: facet?.byPayoutOperator ?? [],
        largestBanWaves: facet?.topWaves ?? [],
        note: 'Concentration under one payoutOperator or a single poseBanHeight suggests a shared operator/config issue vs a network-wide event. Full rows: /api/v1/masternodes/bans/export',
      },
    });
  } catch (error) {
    sendInternalError(res, 'Failed to compute PoSe ban stats', error);
  }
});

export default router;
