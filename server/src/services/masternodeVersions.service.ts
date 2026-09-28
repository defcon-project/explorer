import type { ActiveMasternodeVersionsContract } from '@defcon/shared';
import { config } from '../config';
import { isActiveMasternodeStatus } from '../domain/pose/banAnalytics';
import { NodeInventory } from '../models/NodeInventory';
import { getEnrichedPayload } from './masternode.service';

const VERSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isDeprecated(version: string, required: string): boolean {
  const a = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = required.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

function iso(value: Date | null | undefined): string | null {
  return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}

export async function getActiveMasternodeVersions(): Promise<ActiveMasternodeVersionsContract> {
  // Membership comes from the daemon snapshot, never the historical inventory.
  const snapshot = await getEnrichedPayload();
  // The legacy RPC adapter also returns [] after all RPC fallbacks fail. Do not
  // turn that ambiguous result into a successful "zero active nodes" report.
  if (snapshot.nodes.length === 0) throw new Error('Masternode status snapshot unavailable');
  const active = [...new Map(snapshot.nodes
    .filter((node) => isActiveMasternodeStatus(node.status))
    .map((node) => [node.proTxHash || node.id, node])).values()];
  const endpoints = active.filter((node) => node.ip && node.port != null)
    .map((node) => ({ ip: node.ip, port: node.port }));
  const rows = endpoints.length > 0 ? await NodeInventory.find({ $or: endpoints }).lean() : [];
  const byEndpoint = new Map(rows.map((row) => [JSON.stringify([row.ip, row.port]), row]));
  const now = Date.now();
  const requiredVersion = config.nodeInventory.minimumRecommendedVersion;
  const nodes = active.map((node): ActiveMasternodeVersionsContract['nodes'][number] => {
    const candidate = byEndpoint.get(JSON.stringify([node.ip, node.port]));
    // Do not reuse another registration's retained version after an IP is reassigned.
    const row = candidate?.masternodeProTxHash && node.proTxHash && candidate.masternodeProTxHash !== node.proTxHash
      ? undefined : candidate;
    const walletVersion = row?.walletVersion?.trim() || null;
    const lastVersionObservedAt = iso(row?.lastVersionObservedAt);
    const versionAge = lastVersionObservedAt ? now - Date.parse(lastVersionObservedAt) : null;
    const versionState = !walletVersion ? 'unknown'
      : versionAge != null && versionAge >= 0 && versionAge <= VERSION_MAX_AGE_MS ? 'fresh' : 'stale';
    return {
      id: node.proTxHash || node.id,
      ip: node.ip ?? null,
      port: node.port ?? null,
      status: node.status.trim().toUpperCase() as 'ENABLED' | 'POSE_PENALTY',
      walletVersion,
      versionState,
      lastVersionObservedAt,
      lastInventoryObservedAt: iso(row?.lastObservedAt),
      sources: row?.sources ?? [],
      isDeprecated: walletVersion != null && isDeprecated(walletVersion, requiredVersion),
    };
  }).sort((a, b) => (a.ip || a.id).localeCompare(b.ip || b.id, undefined, { numeric: true }) || a.id.localeCompare(b.id));
  const fresh = nodes.filter((node) => node.versionState === 'fresh');
  const identified = nodes.filter((node) => node.walletVersion != null);
  const counts = new Map<string, number>();
  // Age describes evidence quality, not active membership or version identity.
  // Retain older observations in their last-known version bucket.
  for (const node of identified) counts.set(node.walletVersion!, (counts.get(node.walletVersion!) ?? 0) + 1);
  const percentage = (count: number) => nodes.length > 0 ? Math.round(count / nodes.length * 10_000) / 100 : 0;
  return {
    generatedAt: new Date(now).toISOString(),
    statusObservedAt: snapshot.observedAt,
    inventoryPollSeconds: config.nodeInventory.pollIntervalMs / 1000,
    versionMaxAgeSeconds: VERSION_MAX_AGE_MS / 1000,
    requiredVersion,
    summary: {
      total: nodes.length,
      enabled: nodes.filter((node) => node.status === 'ENABLED').length,
      posePenalty: nodes.filter((node) => node.status === 'POSE_PENALTY').length,
      fresh: fresh.length,
      stale: nodes.filter((node) => node.versionState === 'stale').length,
      unknown: nodes.filter((node) => node.versionState === 'unknown').length,
      coveragePct: percentage(fresh.length),
      recommended: identified.filter((node) => !node.isDeprecated).length,
      deprecated: identified.filter((node) => node.isDeprecated).length,
    },
    versions: [...counts].map(([version, count]) => ({
      version, count, sharePct: percentage(count), isDeprecated: isDeprecated(version, requiredVersion),
    })).sort((a, b) => b.count - a.count || a.version.localeCompare(b.version)),
    nodes,
  };
}
