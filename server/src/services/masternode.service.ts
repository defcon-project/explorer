import { Address } from '../models/Address';
import { Block } from '../models/Block';
import { config } from '../config';
import { rpcService } from './rpc.service';
import { satToCoin, type SatLike } from '../utils/amounts';
import { lookupCountryCode } from '../utils/geoip';
import { createSingleFlight } from '../utils/singleFlight';
import { bulkResolveProviders, UNKNOWN_PROVIDER as PROVIDER_UNKNOWN } from './providerLookup.service';
import { resolveProviderTagsBulk } from './providerTag.service';

// --- Types ---

export interface RawNode {
  id: string;
  service: string;
  status?: string;
  protocol?: number;
  lastSeen?: number;
  activeSeconds?: number;
  proTxHash?: string;
  ownerAddress?: string;
  payoutAddress?: string;
  collateralAddress?: string;
  registeredHeight?: number;
  poseBanHeight?: number;
  poseRevivedHeight?: number;
  posePenalty?: number;
  operatorPubkey?: string;
  votingAddress?: string;
  collateralHash?: string;
  collateralIndex?: number;
  collateralAmount?: number;
}

export interface EnrichedNode {
  id: string;
  service: string;
  ip: string;
  port: number | null;
  status: string;
  protocol: number | null;
  lastSeen: number | null;
  activeSeconds: number | null;
  isTor: boolean;
  countryCode: string;
  countryName: string;
  proTxHash: string | null;
  ownerAddress: string | null;
  payoutAddress: string | null;
  collateralAddress: string | null;
  registeredHeight: number | null;
  registeredAt: number | null;
  poseBanHeight: number | null;
  poseBanAt: number | null;
  poseRevivedHeight: number | null;
  posePenalty: number;
  operatorPubkey: string | null;
  votingAddress: string | null;
  collateralAmount: number | null;
  provider: string;
  providerSource: 'tor' | 'cache' | 'ptr' | 'mmdb' | 'ipapi' | 'tag' | 'unknown';
  asn: number | null;
  asnOrg: string | null;
  providerTagCidr: string | null;
  providerTagSource: string | null;
  providerConfidence: number | null;
  providerEvidenceUrl: string | null;
}

export interface CountrySummary {
  countryCode: string;
  countryName: string;
  count: number;
}

export interface ProviderSummary {
  provider: string;
  count: number;
}

export interface TimePoint {
  date: string;
  timestamp: number;
  active: number;
  newCount: number;
  removedCount: number;
}

export interface WeeklyPoint {
  label: string;
  newCount: number;
  removedCount: number;
}

export interface AnalyticsSummary {
  activeOverTime: TimePoint[];
  newVsRemoved: {
    daily: TimePoint[];
    weekly: WeeklyPoint[];
  };
}

export interface MasternodePayload {
  snapshotId: string;
  observedAt: string;
  total: number;
  countries: CountrySummary[];
  providers: ProviderSummary[];
  nodes: EnrichedNode[];
  analytics: AnalyticsSummary;
}

type AddressBalanceDoc = {
  address: string;
  balanceSat?: SatLike;
};

// --- GeoIP helpers ---

const countryNames =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames !== 'undefined'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

// LRU-style cache for GeoIP lookups (avoids redundant lookups across 100s of MNs)
const GEO_CACHE_LIMIT = 4096;
const geoCache = new Map<string, string>(); // ip -> countryCode

function getCachedGeo(ip: string): string | undefined {
  const val = geoCache.get(ip);
  if (val !== undefined) {
    geoCache.delete(ip);
    geoCache.set(ip, val);
  }
  return val;
}

function setCachedGeo(ip: string, countryCode: string): void {
  if (geoCache.has(ip)) geoCache.delete(ip);
  else if (geoCache.size >= GEO_CACHE_LIMIT) {
    const oldest = geoCache.keys().next().value;
    if (oldest !== undefined) geoCache.delete(oldest);
  }
  geoCache.set(ip, countryCode);
}

export function getCountryName(countryCode: string): string {
  if (countryCode === 'TOR') return 'Tor';
  if (!countryCode || countryCode === 'XX') return 'Unknown';
  if (!countryNames) return countryCode;
  return countryNames.of(countryCode) || countryCode;
}

function normalizeIp(host: string): string {
  if (host.startsWith('::ffff:')) return host.slice(7);
  return host;
}

export function parseService(serviceRaw: string): { host: string; port: number | null; isTor: boolean } {
  const service = String(serviceRaw || '').trim();
  if (!service) {
    return { host: '', port: null, isTor: false };
  }

  const lowered = service.toLowerCase();
  if (lowered.endsWith('.onion') || lowered.includes('.onion:')) {
    const hostOnly = service.split(':')[0];
    const portStr = service.includes(':') ? service.split(':').at(-1) : '';
    const port = portStr && /^\d+$/.test(portStr) ? parseInt(portStr, 10) : null;
    return { host: hostOnly, port, isTor: true };
  }

  const ipv6 = service.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6) {
    return {
      host: normalizeIp(ipv6[1]),
      port: ipv6[2] ? parseInt(ipv6[2], 10) : null,
      isTor: false,
    };
  }

  const lastColon = service.lastIndexOf(':');
  if (lastColon > -1 && service.indexOf(':') === lastColon) {
    const host = service.slice(0, lastColon);
    const portStr = service.slice(lastColon + 1);
    return {
      host: normalizeIp(host),
      port: /^\d+$/.test(portStr) ? parseInt(portStr, 10) : null,
      isTor: false,
    };
  }

  return { host: normalizeIp(service), port: null, isTor: false };
}

// --- RPC parsers ---

export function parseMasternodeListFull(payload: unknown): RawNode[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];

  const result: RawNode[] = [];
  for (const [id, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === 'string') {
      const parts = value.trim().split(/\s+/);
      if (parts.length === 0) continue;
      const service = parts[parts.length - 1] || '';
      const status = parts[0] || 'UNKNOWN';
      const protocol = Number.isFinite(Number(parts[1])) ? parseInt(parts[1], 10) : undefined;
      const lastSeen = Number.isFinite(Number(parts[3])) ? parseInt(parts[3], 10) : undefined;
      const activeSeconds = Number.isFinite(Number(parts[4])) ? parseInt(parts[4], 10) : undefined;
      result.push({ id, service, status, protocol, lastSeen, activeSeconds });
      continue;
    }

    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const service = String(obj.ip || obj.addr || obj.service || '');
      if (!service) continue;

      const protocolValue = obj.protocol;
      const lastSeenValue = obj.lastseen || obj.lastSeen;
      const activeValue = obj.activeseconds || obj.activeSeconds;

      result.push({
        id,
        service,
        status: String(obj.status || 'UNKNOWN'),
        protocol:
          typeof protocolValue === 'number'
            ? protocolValue
            : Number.isFinite(Number(protocolValue))
              ? parseInt(String(protocolValue), 10)
              : undefined,
        lastSeen:
          typeof lastSeenValue === 'number'
            ? lastSeenValue
            : Number.isFinite(Number(lastSeenValue))
              ? parseInt(String(lastSeenValue), 10)
              : undefined,
        activeSeconds:
          typeof activeValue === 'number'
            ? activeValue
            : Number.isFinite(Number(activeValue))
              ? parseInt(String(activeValue), 10)
              : undefined,
      });
    }
  }

  return result;
}

function parseMasternodeListAddr(payload: unknown): RawNode[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];

  return Object.entries(payload as Record<string, unknown>)
    .map(([id, value]) => ({
      id,
      service: String(value || ''),
      status: 'ENABLED',
    }))
    .filter((item) => item.service.length > 0);
}

export function parseProtxList(payload: unknown): RawNode[] {
  if (!Array.isArray(payload)) return [];

  const result: RawNode[] = [];
  for (const item of payload as Array<Record<string, unknown>>) {
    const state = (item.state || {}) as Record<string, unknown>;

    const service = String(state.service || item.service || item.addr || '');
    const collateralHash = String(item.collateralHash || '');
    const collateralIndex = Number.isFinite(Number(item.collateralIndex))
      ? parseInt(String(item.collateralIndex), 10)
      : null;
    const outpointId =
      collateralHash && collateralIndex != null ? `${collateralHash}-${collateralIndex}` : '';

    const proTxHash = String(item.proTxHash || item.hash || '');
    const id = outpointId || proTxHash;
    if (!id || !service) continue;

    const posePenalty = typeof state.PoSePenalty === 'number' ? state.PoSePenalty : 0;
    const poseBanHeight = typeof state.PoSeBanHeight === 'number' ? state.PoSeBanHeight : -1;
    let status = 'ENABLED';
    if (poseBanHeight > 0) {
      status = 'POSE_BANNED';
    } else if (posePenalty > 0) {
      status = 'POSE_PENALTY';
    }

    result.push({
      id,
      proTxHash: proTxHash || undefined,
      service,
      status,
      protocol:
        typeof state.version === 'number'
          ? state.version
          : typeof state.nVersion === 'number'
            ? state.nVersion
            : undefined,
      ownerAddress: typeof state.ownerAddress === 'string' ? state.ownerAddress : undefined,
      payoutAddress: typeof state.payoutAddress === 'string' ? state.payoutAddress : undefined,
      operatorPubkey:
        typeof state.pubKeyOperator === 'string'
          ? state.pubKeyOperator
          : typeof state.operatorPubKey === 'string'
            ? (state.operatorPubKey as string)
            : undefined,
      votingAddress: typeof state.votingAddress === 'string' ? state.votingAddress : undefined,
      posePenalty: typeof state.PoSePenalty === 'number' ? state.PoSePenalty : undefined,
      poseRevivedHeight:
        typeof state.PoSeRevivedHeight === 'number' && state.PoSeRevivedHeight > 0
          ? (state.PoSeRevivedHeight as number)
          : undefined,
      collateralAddress:
        typeof item.collateralAddress === 'string'
          ? (item.collateralAddress as string)
          : undefined,
      registeredHeight:
        typeof state.registeredHeight === 'number' ? state.registeredHeight : undefined,
      poseBanHeight: poseBanHeight > 0 ? poseBanHeight : undefined,
      lastSeen: typeof item.lastseen === 'number' ? item.lastseen : undefined,
      collateralHash: collateralHash || undefined,
      collateralIndex: collateralIndex != null ? collateralIndex : undefined,
    });
  }

  return result;
}

async function fetchProtxNodes(): Promise<RawNode[]> {
  const attempts: Array<() => Promise<RawNode[]>> = [
    async () => parseProtxList(await rpcService.call('protx', ['list', 'registered', 1])),
    async () => parseProtxList(await rpcService.call('protx', ['list', 'valid', 1])),
  ];

  for (const attempt of attempts) {
    try {
      const nodes = await attempt();
      if (nodes.length > 0) return nodes;
    } catch {
      // Try next fallback
    }
  }

  return [];
}

export async function fetchRawMasternodes(): Promise<RawNode[]> {
  const protxNodes = await fetchProtxNodes();

  if (protxNodes.length > 0) {
    try {
      const fullPayload = await rpcService.call('masternodelist', ['full']);
      const full = parseMasternodeListFull(fullPayload);
      const byService = new Map(full.map((node) => [node.service, node]));
      return protxNodes.map((node) => {
        const fromFull = byService.get(node.service);
        return {
          ...fromFull,
          ...node,
          service: node.service,
          id: node.id,
        };
      });
    } catch {
      return protxNodes;
    }
  }

  const fallbacks: Array<() => Promise<RawNode[]>> = [
    async () => parseMasternodeListFull(await rpcService.call('masternodelist', ['full'])),
    async () => parseMasternodeListAddr(await rpcService.call('masternodelist', ['addr'])),
  ];

  for (const attempt of fallbacks) {
    try {
      const nodes = await attempt();
      if (nodes.length > 0) return nodes;
    } catch {
      // Try next fallback
    }
  }

  return [];
}

function estimateTimeByHeight(
  height: number,
  latestHeight: number | null,
  latestTime: number | null,
  avgBlockTime: number
) {
  if (latestHeight == null || latestTime == null) return null;
  const diff = latestHeight - height;
  return Math.max(0, Math.round(latestTime - diff * avgBlockTime));
}

export async function hydrateCollateralAmounts(nodes: RawNode[]): Promise<void> {
  const collateralAddresses = Array.from(
    new Set(
      nodes
        .map((node) => node.collateralAddress)
        .filter((address): address is string => typeof address === 'string' && address.length > 0)
    )
  );

  if (collateralAddresses.length > 0) {
    const docs = await Address.find({ address: { $in: collateralAddresses } })
      .select({ address: 1, balanceSat: 1 })
      .lean<AddressBalanceDoc[]>();
    const balanceMap = new Map(
      docs.map((doc) => [doc.address, satToCoin(doc.balanceSat ?? 0)])
    );
    for (const node of nodes) {
      if (!node.collateralAddress) continue;
      const balance = balanceMap.get(node.collateralAddress);
      if (typeof balance === 'number' && Number.isFinite(balance) && balance > 0) {
        node.collateralAmount = balance;
      }
    }
  }

  const missing = nodes.filter(
    (node) =>
      (node.collateralAmount == null || node.collateralAmount <= 0) &&
      node.collateralHash &&
      typeof node.collateralIndex === 'number'
  );

  if (missing.length === 0) return;

  const resolved = await Promise.allSettled(
    missing.map((node) =>
      rpcService.call<{ value?: number }>('gettxout', [node.collateralHash, node.collateralIndex, true])
    )
  );

  resolved.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const value = result.value?.value;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      missing[index].collateralAmount = value;
    }
  });
}

export function enrichNodes(nodes: RawNode[]): EnrichedNode[] {
  const seenServices = new Set<string>();
  const enriched: EnrichedNode[] = [];

  for (const node of nodes) {
    const parsed = parseService(node.service);
    if (!parsed.host) continue;

    const uniqueKey = `${parsed.host}:${parsed.port ?? ''}`;
    if (seenServices.has(uniqueKey)) continue;
    seenServices.add(uniqueKey);

    let countryCode: string;
    if (parsed.isTor) {
      countryCode = 'TOR';
    } else {
      const cached = getCachedGeo(parsed.host);
      if (cached !== undefined) {
        countryCode = cached;
      } else {
        countryCode = lookupCountryCode(parsed.host) || 'XX';
        setCachedGeo(parsed.host, countryCode);
      }
    }

    const registeredAt =
      typeof node.lastSeen === 'number' && typeof node.activeSeconds === 'number'
        ? Math.max(0, node.lastSeen - node.activeSeconds)
        : null;

    enriched.push({
      id: node.id,
      service: node.service,
      ip: parsed.host,
      port: parsed.port,
      status: node.status || 'UNKNOWN',
      protocol: typeof node.protocol === 'number' ? node.protocol : null,
      lastSeen: typeof node.lastSeen === 'number' ? node.lastSeen : null,
      activeSeconds: typeof node.activeSeconds === 'number' ? node.activeSeconds : null,
      isTor: parsed.isTor,
      countryCode,
      countryName: getCountryName(countryCode),
      proTxHash: typeof node.proTxHash === 'string' ? node.proTxHash : null,
      ownerAddress: typeof node.ownerAddress === 'string' ? node.ownerAddress : null,
      payoutAddress: typeof node.payoutAddress === 'string' ? node.payoutAddress : null,
      collateralAddress:
        typeof node.collateralAddress === 'string' ? node.collateralAddress : null,
      registeredHeight:
        typeof node.registeredHeight === 'number' ? node.registeredHeight : null,
      registeredAt,
      poseBanHeight: typeof node.poseBanHeight === 'number' ? node.poseBanHeight : null,
      poseBanAt: null,
      poseRevivedHeight:
        typeof node.poseRevivedHeight === 'number' ? node.poseRevivedHeight : null,
      posePenalty: typeof node.posePenalty === 'number' ? node.posePenalty : 0,
      operatorPubkey: typeof node.operatorPubkey === 'string' ? node.operatorPubkey : null,
      votingAddress: typeof node.votingAddress === 'string' ? node.votingAddress : null,
      collateralAmount:
        typeof node.collateralAmount === 'number' && Number.isFinite(node.collateralAmount)
          ? node.collateralAmount
          : null,
      provider: parsed.isTor ? 'Tor' : PROVIDER_UNKNOWN,
      providerSource: parsed.isTor ? 'tor' : 'unknown',
      asn: null,
      asnOrg: null,
      providerTagCidr: null,
      providerTagSource: null,
      providerConfidence: null,
      providerEvidenceUrl: null,
    });
  }

  return enriched.sort((a, b) => {
    if (a.countryName !== b.countryName) return a.countryName.localeCompare(b.countryName);
    return a.ip.localeCompare(b.ip);
  });
}

async function hydrateProviders(nodes: EnrichedNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const inputs = nodes.map((n) => ({ host: n.ip, isTor: n.isTor }));
  const results = await bulkResolveProviders(inputs);
  for (const node of nodes) {
    const key = String(node.ip || '').trim().toLowerCase();
    const info = results.get(key);
    if (!info) continue;
    node.provider = info.provider;
    node.providerSource = info.source;
    node.asn = info.asn;
    node.asnOrg = info.asnOrg;
  }
}

// Community-submitted, admin-approved CIDR -> provider tags take precedence
// over automated lookups (PTR/MMDB/ip-api), since they were manually verified.
async function hydrateProviderTags(nodes: EnrichedNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const ips = nodes.filter((n) => !n.isTor).map((n) => n.ip);
  const matches = await resolveProviderTagsBulk(ips);
  if (matches.size === 0) return;

  for (const node of nodes) {
    const key = String(node.ip || '').trim().toLowerCase();
    const match = matches.get(key);
    if (!match) continue;
    node.provider = match.provider;
    node.providerSource = 'tag';
    node.providerTagCidr = match.cidr;
    node.providerTagSource = match.source;
    node.providerConfidence = match.confidence;
    node.providerEvidenceUrl = match.evidenceUrl;
  }
}

function buildProviderSummary(nodes: EnrichedNode[]): ProviderSummary[] {
  const providerMap = new Map<string, number>();
  for (const node of nodes) {
    const provider = node.provider || PROVIDER_UNKNOWN;
    providerMap.set(provider, (providerMap.get(provider) || 0) + 1);
  }

  return Array.from(providerMap.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.provider.localeCompare(b.provider);
    });
}

export async function applyHeightTimes(nodes: EnrichedNode[]) {
  const heights = new Set<number>();
  for (const node of nodes) {
    if (typeof node.registeredHeight === 'number' && node.registeredHeight >= 0) {
      heights.add(node.registeredHeight);
    }
    if (typeof node.poseBanHeight === 'number' && node.poseBanHeight >= 0) {
      heights.add(node.poseBanHeight);
    }
  }

  if (heights.size === 0) return;

  // Single $facet query instead of 3 separate Block queries
  const [facetResult] = await Block.aggregate<{
    latest: Array<{ height: number; time: number }>;
    recent: Array<{ time: number }>;
    byHeight: Array<{ height: number; time: number }>;
  }>([
    {
      $facet: {
        latest: [
          { $sort: { height: -1 } },
          { $limit: 1 },
          { $project: { height: 1, time: 1, _id: 0 } },
        ],
        recent: [
          { $sort: { height: -1 } },
          { $limit: 20 },
          { $project: { time: 1, _id: 0 } },
        ],
        byHeight: [
          { $match: { height: { $in: Array.from(heights) } } },
          { $project: { height: 1, time: 1, _id: 0 } },
        ],
      },
    },
  ]);

  const latestBlock = facetResult?.latest?.[0] ?? null;
  const recentBlocks = facetResult?.recent ?? [];
  const heightBlocks = facetResult?.byHeight ?? [];

  const timeMap = new Map<number, number>();
  for (const block of heightBlocks) {
    timeMap.set(block.height, block.time);
  }

  let avgBlockTime = 60;
  if (recentBlocks.length >= 2) {
    const newest = recentBlocks[0].time;
    const oldest = recentBlocks[recentBlocks.length - 1].time;
    avgBlockTime = Math.max(1, (newest - oldest) / (recentBlocks.length - 1));
  }

  for (const node of nodes) {
    if (typeof node.registeredHeight === 'number') {
      node.registeredAt =
        timeMap.get(node.registeredHeight) ??
        estimateTimeByHeight(
          node.registeredHeight,
          latestBlock?.height ?? null,
          latestBlock?.time ?? null,
          avgBlockTime
        ) ??
        node.registeredAt;
    }

    if (typeof node.poseBanHeight === 'number') {
      node.poseBanAt =
        timeMap.get(node.poseBanHeight) ??
        estimateTimeByHeight(
          node.poseBanHeight,
          latestBlock?.height ?? null,
          latestBlock?.time ?? null,
          avgBlockTime
        );
    }
  }
}

function formatDay(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function buildAnalytics(nodes: EnrichedNode[]): AnalyticsSummary {
  const daySeconds = 86400;
  const now = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor(now / daySeconds) * daySeconds;
  const days = 30;
  const start = todayStart - (days - 1) * daySeconds;

  const points: TimePoint[] = Array.from({ length: days }, (_, i) => {
    const ts = start + i * daySeconds;
    return {
      date: formatDay(ts),
      timestamp: ts,
      active: 0,
      newCount: 0,
      removedCount: 0,
    };
  });

  const indexByDate = new Map(points.map((point, index) => [point.date, index]));
  let baseActive = 0;

  for (const node of nodes) {
    const activeFrom =
      typeof node.lastSeen === 'number' && typeof node.activeSeconds === 'number'
        ? Math.max(0, node.lastSeen - node.activeSeconds)
        : typeof node.registeredAt === 'number'
          ? node.registeredAt
          : null;

    const nodeStatus = String(node.status || '').toUpperCase();
    const isBanned = nodeStatus.includes('BAN');
    const removedAt =
      typeof node.poseBanAt === 'number'
        ? node.poseBanAt
        : isBanned && typeof node.lastSeen === 'number'
          ? node.lastSeen
          : null;

    if (activeFrom != null) {
      const regDate = formatDay(Math.floor(activeFrom / daySeconds) * daySeconds);
      if (activeFrom < start) {
        baseActive += 1;
      } else if (activeFrom <= now) {
        const idx = indexByDate.get(regDate);
        if (idx != null) points[idx].newCount += 1;
      }
    }

    if (removedAt != null && removedAt <= now) {
      const remDate = formatDay(Math.floor(removedAt / daySeconds) * daySeconds);
      if (removedAt < start) {
        baseActive -= 1;
      } else {
        const idx = indexByDate.get(remDate);
        if (idx != null) points[idx].removedCount += 1;
      }
    }
  }

  let running = Math.max(0, baseActive);
  for (const point of points) {
    running += point.newCount - point.removedCount;
    point.active = Math.max(0, running);
  }

  const weekly: WeeklyPoint[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const slice = points.slice(i, i + 7);
    if (slice.length === 0) continue;
    const label = `${slice[0].date.slice(5)} - ${slice[slice.length - 1].date.slice(5)}`;
    weekly.push({
      label,
      newCount: slice.reduce((sum, point) => sum + point.newCount, 0),
      removedCount: slice.reduce((sum, point) => sum + point.removedCount, 0),
    });
  }

  return {
    activeOverTime: points,
    newVsRemoved: {
      daily: points,
      weekly,
    },
  };
}

// --- Cached full payload ---

let cached: { atMs: number; payload: MasternodePayload } | null = null;
const enrichedPayloadSingleFlight = createSingleFlight<MasternodePayload>();
let snapshotSequence = 0;

async function buildEnrichedPayload(): Promise<MasternodePayload> {
  const rawNodes = await fetchRawMasternodes();
  await hydrateCollateralAmounts(rawNodes);

  const nodes = enrichNodes(rawNodes);
  await applyHeightTimes(nodes);
  await hydrateProviders(nodes);
  await hydrateProviderTags(nodes);

  const countryMap = new Map<string, CountrySummary>();
  for (const node of nodes) {
    const code = node.countryCode || 'XX';
    const current = countryMap.get(code) || {
      countryCode: code,
      countryName: node.countryName || getCountryName(code),
      count: 0,
    };
    current.count += 1;
    countryMap.set(code, current);
  }

  const countries = Array.from(countryMap.values()).sort((a, b) => b.count - a.count);
  const providers = buildProviderSummary(nodes);
  const analytics = buildAnalytics(nodes);
  const observedAtMs = Date.now();

  return {
    snapshotId: `mn-${observedAtMs.toString(36)}-${(++snapshotSequence).toString(36)}`,
    observedAt: new Date(observedAtMs).toISOString(),
    total: nodes.length,
    countries,
    providers,
    nodes,
    analytics,
  };
}

export async function getEnrichedPayload(): Promise<MasternodePayload> {
  const now = Date.now();
  const ttlMs = Math.max(0, config.cache.ttlSeconds) * 1000;
  if (cached && ttlMs > 0 && now - cached.atMs < ttlMs) {
    return cached.payload;
  }

  return enrichedPayloadSingleFlight.run(async () => {
    const refreshNow = Date.now();
    if (cached && ttlMs > 0 && refreshNow - cached.atMs < ttlMs) {
      return cached.payload;
    }

    const payload = await buildEnrichedPayload();
    cached = { atMs: Date.now(), payload };
    return payload;
  });
}

export async function getEnrichedNodes(): Promise<EnrichedNode[]> {
  const payload = await getEnrichedPayload();
  return payload.nodes;
}
