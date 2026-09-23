import { Router, Request, Response } from 'express';
import {
  nodeInventoryApiResponseSchema,
  networkVersionSampleApiResponseSchema,
} from '@defcon/shared/dist/contracts';
import { NodeInventory } from '../../models/NodeInventory';
import { config } from '../../config';
import { withCachePolicy } from '../../middleware/cachePolicy';
import { sendInternalError } from '../../utils/validation';
import { STALE_AFTER_MS } from '../../services/nodeInventory.service';

const router = Router();

type InventoryChainStatus = 'main_chain' | 'ahead' | 'behind' | 'hash_mismatch' | 'unknown';
const CHAIN_STATUSES = new Set<InventoryChainStatus>(['main_chain', 'ahead', 'behind', 'hash_mismatch', 'unknown']);

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function timestampMs(value: unknown): number | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Node inventory contains an invalid ${field} timestamp`);
  }
  return date.toISOString();
}

function toOptionalIsoDate(value: unknown, field: string): string | null {
  return value == null ? null : toIsoDate(value, field);
}

// GET /api/v1/node-inventory/versions - Lightweight, multi-source version sample for the public Network page.
router.get('/versions', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const requestedHours = Number.parseInt(String(req.query.hours ?? '24'), 10);
    const windowHours = Math.min(Math.max(Number.isFinite(requestedHours) ? requestedHours : 24, 1), 168);
    const generatedAt = new Date();
    const from = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);
    const requiredVersion = config.nodeInventory.minimumRecommendedVersion;

    const rows = await NodeInventory.find({
      $or: [
        { lastSeenAt: { $gte: from } },
        { lastSeenAt: null, lastObservedAt: { $gte: from } },
        { lastSeenAt: { $exists: false }, lastObservedAt: { $gte: from } },
      ],
    })
      .sort({ lastObservedAt: -1, ip: 1 })
      .lean();

    // A node may be present under more than one port/source. The public sample
    // represents hosts, so keep the freshest observation for each IP address.
    const byIp = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const ip = String(row.ip || '').trim();
      if (!ip) continue;
      const freshAt = timestampMs(row.lastSeenAt) ?? timestampMs(row.lastObservedAt);
      if (freshAt == null || freshAt < from.getTime()) continue;

      const current = byIp.get(ip);
      const currentFreshAt = current
        ? (timestampMs(current.lastSeenAt) ?? timestampMs(current.lastObservedAt) ?? 0)
        : -1;
      if (!current || freshAt > currentFreshAt) byIp.set(ip, row);
    }

    const observed = Array.from(byIp.values());
    const identified = observed.filter((row) => Boolean(String(row.walletVersion || '').trim()));
    const versionCounts = new Map<string, number>();
    for (const row of identified) {
      const version = String(row.walletVersion).trim();
      versionCounts.set(version, (versionCounts.get(version) ?? 0) + 1);
    }

    const versions = Array.from(versionCounts.entries())
      .map(([version, count]) => ({
        version,
        count,
        observedSharePct: observed.length > 0 ? Math.round((count / observed.length) * 10_000) / 100 : 0,
        sharePct: identified.length > 0 ? Math.round((count / identified.length) * 10_000) / 100 : 0,
        isDeprecated: compareVersions(version, requiredVersion) < 0,
      }))
      .sort((a, b) => b.count - a.count || compareVersions(b.version, a.version));

    const nodes = identified
      .map((row) => ({
        ip: row.ip,
        port: row.port,
        walletVersion: row.walletVersion,
        protocolVersion: row.protocolVersion,
        blockHeight: row.blockHeight,
        sources: row.sources || [],
        lastSeenAt: toOptionalIsoDate(row.lastSeenAt, 'lastSeenAt'),
        lastObservedAt: toIsoDate(row.lastObservedAt, 'lastObservedAt'),
        lastVersionObservedAt: toOptionalIsoDate(
          row.lastVersionObservedAt ?? row.lastSeenAt ?? row.lastObservedAt,
          'lastVersionObservedAt'
        ),
        isDeprecated: compareVersions(String(row.walletVersion), requiredVersion) < 0,
      }))
      .sort((a, b) => {
        const versionOrder = compareVersions(String(b.walletVersion), String(a.walletVersion));
        return versionOrder || String(a.ip).localeCompare(String(b.ip), undefined, { numeric: true });
      });

    return res.json(networkVersionSampleApiResponseSchema.parse({
      success: true,
      data: {
        generatedAt: generatedAt.toISOString(),
        windowHours,
        requiredVersion,
        summary: {
          observed: observed.length,
          identified: identified.length,
          unidentified: observed.length - identified.length,
          coveragePct: observed.length > 0
            ? Math.round((identified.length / observed.length) * 10_000) / 100
            : 0,
          recommended: identified.filter((row) => compareVersions(String(row.walletVersion), requiredVersion) >= 0).length,
          deprecated: identified.filter((row) => compareVersions(String(row.walletVersion), requiredVersion) < 0).length,
        },
        versions,
        nodes,
      },
    }));
  } catch (error) {
    return sendInternalError(res, 'Failed to load network version sample', error);
  }
});

router.get('/', withCachePolicy('short'), async (req: Request, res: Response) => {
  try {
    const version = String(req.query.version ?? '').trim();
    const source = String(req.query.source ?? '').trim();
    const chainStatus = String(req.query.chainStatus ?? '').trim() as InventoryChainStatus;
    const legacyOnly = String(req.query.legacy ?? '').trim() === '1';
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? '500'), 10) || 500, 1), 1000);
    const requiredVersion = config.nodeInventory.minimumRecommendedVersion;

    const allRows = await NodeInventory.find({})
      .sort({ lastObservedAt: -1, ip: 1 })
      .lean();

    const now = Date.now();
    const decorate = (row: typeof allRows[number]) => {
      const knownVersion = Boolean(row.walletVersion);
      const isDeprecated = knownVersion && compareVersions(String(row.walletVersion), requiredVersion) < 0;
      const isStale = !row.lastObservedAt || now - new Date(row.lastObservedAt).getTime() > STALE_AFTER_MS;
      return {
        ...row,
        isDeprecated,
        isStale,
      };
    };
    const decorated = allRows.map(decorate);
    const filtered = decorated.filter((row) => {
      if (version && row.walletVersion !== version) return false;
      if (source && !(row.sources || []).includes(source)) return false;
      if (chainStatus && CHAIN_STATUSES.has(chainStatus) && row.chainStatus !== chainStatus) return false;
      if (legacyOnly && !row.isDeprecated) return false;
      return true;
    });

    const versionCounts = new Map<string, number>();
    for (const row of decorated) {
      const label = row.walletVersion || 'Unknown';
      versionCounts.set(label, (versionCounts.get(label) ?? 0) + 1);
    }

    const summary = {
      observed: decorated.length,
      knownVersion: decorated.filter((row) => Boolean(row.walletVersion)).length,
      recommended: decorated.filter((row) => row.walletVersion && !row.isDeprecated).length,
      deprecated: decorated.filter((row) => row.isDeprecated).length,
      mainChain: decorated.filter((row) => row.chainStatus === 'main_chain').length,
      chainRisk: decorated.filter((row) => ['ahead', 'behind', 'hash_mismatch'].includes(row.chainStatus)).length,
      stale: decorated.filter((row) => row.isStale).length,
    };

    return res.json(nodeInventoryApiResponseSchema.parse({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        requiredVersion,
        staleAfterSeconds: STALE_AFTER_MS / 1000,
        summary,
        versions: Array.from(versionCounts.entries())
          .map(([versionLabel, count]) => ({ version: versionLabel, count }))
          .sort((a, b) => b.count - a.count || a.version.localeCompare(b.version)),
        total: filtered.length,
        nodes: filtered.slice(0, limit).map((row) => ({
          ...row,
          firstSeenAt: toIsoDate(row.firstSeenAt, 'firstSeenAt'),
          lastSeenAt: toOptionalIsoDate(row.lastSeenAt, 'lastSeenAt'),
          lastObservedAt: toIsoDate(row.lastObservedAt, 'lastObservedAt'),
        })),
      },
    }));
  } catch (error) {
    return sendInternalError(res, 'Failed to load node inventory', error);
  }
});

export default router;
