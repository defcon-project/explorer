import { Router, Request, Response } from 'express';
import {
  masternodeApiResponseSchema,
  masternodeDistributionApiResponseSchema,
  masternodeNodesApiResponseSchema,
  masternodeSummaryApiResponseSchema,
} from '@defcon/shared/dist/contracts';
import {
  getEnrichedPayload,
  type EnrichedNode,
  type MasternodePayload,
} from '../services/masternode.service';
import { withCachePolicy } from '../middleware/cachePolicy';
import { sendServiceUnavailable } from '../utils/validation';

const router = Router();
const DEFAULT_NODE_PAGE_SIZE = 100;
const MAX_NODE_PAGE_SIZE = 500;

type ProviderSourceFilter = 'all' | 'tagged' | 'auto';

function normalizeStatus(status: string | null | undefined): string {
  return String(status || '').trim().toUpperCase();
}

function isActiveMasternodeStatus(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'ENABLED' || normalized === 'POSE_PENALTY';
}

function buildProviderSourceSummary(nodes: EnrichedNode[]) {
  const providerMap = new Map<string, { provider: string; count: number; tagged: number; auto: number }>();
  for (const node of nodes) {
    const provider = String(node.provider || 'Unknown');
    const existing = providerMap.get(provider) || { provider, count: 0, tagged: 0, auto: 0 };
    existing.count += 1;
    if (node.providerSource === 'tag') existing.tagged += 1;
    else existing.auto += 1;
    providerMap.set(provider, existing);
  }

  return Array.from(providerMap.values()).sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.provider.localeCompare(b.provider);
  });
}

function buildSummary(payload: MasternodePayload) {
  const activeNodes = payload.nodes.filter((node) => isActiveMasternodeStatus(node.status));
  const enabled = activeNodes.length;
  const poseBanned = payload.nodes.filter((node) => normalizeStatus(node.status).includes('BAN')).length;
  const posePenalty = payload.nodes.filter((node) => normalizeStatus(node.status).includes('PENALTY')).length;
  const tagged = activeNodes.filter((node) => node.providerSource === 'tag').length;
  const providers = buildProviderSourceSummary(activeNodes);
  const countryMap = new Map<string, { countryCode: string; countryName: string; count: number }>();
  for (const node of activeNodes) {
    const countryCode = node.countryCode || 'XX';
    const current = countryMap.get(countryCode) || {
      countryCode,
      countryName: node.countryName || countryCode,
      count: 0,
    };
    current.count += 1;
    countryMap.set(countryCode, current);
  }
  const activeCountries = Array.from(countryMap.values()).sort((a, b) => b.count - a.count);

  return {
    snapshotId: payload.snapshotId,
    observedAt: payload.observedAt,
    total: payload.total,
    enabled,
    poseBanned,
    posePenalty,
    countries: activeCountries.length,
    tagged,
    taggedCoveragePct: enabled > 0 ? (tagged / enabled) * 100 : 0,
    enabledPct: payload.total > 0 ? (enabled / payload.total) * 100 : 0,
    topCountry: activeCountries[0] || null,
    topProvider: providers[0] || null,
  };
}

function toNodeListItem(node: EnrichedNode) {
  return {
    id: node.id,
    service: node.service,
    ip: node.ip,
    port: node.port,
    status: node.status,
    lastSeen: node.lastSeen,
    countryCode: node.countryCode,
    countryName: node.countryName,
    provider: node.provider,
    providerSource: node.providerSource,
    providerTagCidr: node.providerTagCidr,
    providerTagSource: node.providerTagSource,
    providerConfidence: node.providerConfidence,
    providerEvidenceUrl: node.providerEvidenceUrl,
    asn: node.asn,
    asnOrg: node.asnOrg,
  };
}

function getQueryValue(value: unknown): string {
  if (Array.isArray(value)) return getQueryValue(value[0]);
  return typeof value === 'string' ? value.trim() : '';
}

function getPositiveIntQuery(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(getQueryValue(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function getProviderSourceFilter(value: unknown): ProviderSourceFilter {
  const raw = getQueryValue(value).toLowerCase();
  if (raw === 'tagged' || raw === 'auto') return raw;
  return 'all';
}

function getExcludeCountries(value: unknown): Set<string> {
  return new Set(
    getQueryValue(value)
      .split(',')
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  );
}

function filterNodes(
  nodes: EnrichedNode[],
  filters: {
    countryCode: string;
    excludeCountries: Set<string>;
    provider: string;
    source: ProviderSourceFilter;
  }
) {
  return nodes.filter((node) => {
    const countryCode = String(node.countryCode || '').toUpperCase();
    if (filters.countryCode && countryCode !== filters.countryCode) return false;
    if (!filters.countryCode && filters.excludeCountries.has(countryCode)) return false;
    if (filters.provider && String(node.provider || '') !== filters.provider) return false;
    if (filters.source === 'tagged' && node.providerSource !== 'tag') return false;
    if (filters.source === 'auto' && node.providerSource === 'tag') return false;
    return true;
  });
}

router.get('/summary', withCachePolicy('medium'), async (_req: Request, res: Response) => {
  try {
    const payload = await getEnrichedPayload();
    return res.json(masternodeSummaryApiResponseSchema.parse({ success: true, data: buildSummary(payload) }));
  } catch (error) {
    return sendServiceUnavailable(res, 'Could not fetch masternode summary from daemon RPC', error);
  }
});

router.get('/distribution', withCachePolicy('medium'), async (_req: Request, res: Response) => {
  try {
    const payload = await getEnrichedPayload();
    const activeNodes = payload.nodes.filter((node) => isActiveMasternodeStatus(node.status));
    const countryMap = new Map<string, { countryCode: string; countryName: string; count: number }>();
    for (const node of activeNodes) {
      const countryCode = node.countryCode || 'XX';
      const current = countryMap.get(countryCode) || {
        countryCode,
        countryName: node.countryName || countryCode,
        count: 0,
      };
      current.count += 1;
      countryMap.set(countryCode, current);
    }
    const countries = Array.from(countryMap.values()).sort((a, b) => b.count - a.count);

    return res.json(masternodeDistributionApiResponseSchema.parse({
      success: true,
      data: {
        snapshotId: payload.snapshotId,
        observedAt: payload.observedAt,
        total: activeNodes.length,
        countries,
        providers: buildProviderSourceSummary(activeNodes),
      },
    }));
  } catch (error) {
    return sendServiceUnavailable(res, 'Could not fetch masternode distribution from daemon RPC', error);
  }
});

router.get('/nodes', withCachePolicy('medium'), async (req: Request, res: Response) => {
  try {
    const payload = await getEnrichedPayload();
    const page = getPositiveIntQuery(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = getPositiveIntQuery(
      req.query.limit,
      DEFAULT_NODE_PAGE_SIZE,
      1,
      MAX_NODE_PAGE_SIZE
    );
    const source = getProviderSourceFilter(req.query.source);
    const countryCode = getQueryValue(req.query.country).toUpperCase();
    const provider = getQueryValue(req.query.provider);
    const excludeCountries = getExcludeCountries(req.query.excludeCountries);
    const baseFilteredNodes = filterNodes(payload.nodes, {
      countryCode,
      excludeCountries,
      provider,
      source: 'all',
    });
    const sourceCounts = {
      all: baseFilteredNodes.length,
      tagged: baseFilteredNodes.filter((node) => node.providerSource === 'tag').length,
      auto: baseFilteredNodes.filter((node) => node.providerSource !== 'tag').length,
    };
    const filteredNodes =
      source === 'all'
        ? baseFilteredNodes
        : filterNodes(baseFilteredNodes, {
            countryCode: '',
            excludeCountries: new Set<string>(),
            provider: '',
            source,
          });
    const pages = Math.max(1, Math.ceil(filteredNodes.length / pageSize));
    const safePage = Math.min(page, pages);
    const offset = (safePage - 1) * pageSize;
    const pageNodes = filteredNodes.slice(offset, offset + pageSize);

    return res.json(masternodeNodesApiResponseSchema.parse({
      success: true,
      data: {
        snapshotId: payload.snapshotId,
        observedAt: payload.observedAt,
        total: payload.total,
        filteredTotal: filteredNodes.length,
        page: safePage,
        pageSize,
        pages,
        sourceCounts,
        nodes: pageNodes.map(toNodeListItem),
      },
    }));
  } catch (error) {
    return sendServiceUnavailable(res, 'Could not fetch masternode nodes from daemon RPC', error);
  }
});

router.get('/', withCachePolicy('medium'), async (_req: Request, res: Response) => {
  try {
    const payload = await getEnrichedPayload();
    return res.json(masternodeApiResponseSchema.parse({ success: true, data: payload }));
  } catch (error) {
    return sendServiceUnavailable(res, 'Could not fetch masternodes from daemon RPC', error);
  }
});

export default router;
