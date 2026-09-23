import axios from 'axios';
import { isIP } from 'node:net';
import { config } from '../config';
import { NodeInventory } from '../models/NodeInventory';
import { NodeInventoryEvent } from '../models/NodeInventoryEvent';
import { getEnrichedNodes, parseService } from './masternode.service';
import { rpcService } from './rpc.service';
import { seedNodeService } from './seedNode.service';
import { logger } from '../utils/logger';

export type InventorySource = 'seed_node' | 'dns_seeder' | 'pre_release' | 'direct_peer' | 'masternode_rpc';
export type InventoryChainStatus = 'main_chain' | 'ahead' | 'behind' | 'hash_mismatch' | 'unknown';

type PeerInfo = {
  addr?: string;
  subver?: string;
  version?: number;
  synced_headers?: number;
  synced_blocks?: number;
};

type BlockchainInfo = {
  blocks?: number;
  bestblockhash?: string;
};

type InventoryCandidate = {
  ip: string;
  port: number;
  source: InventorySource;
  label?: string | null;
  walletVersion?: string | null;
  protocolVersion?: number | null;
  blockHeight?: number | null;
  bestBlockHash?: string | null;
  connections?: number | null;
  syncProgress?: number | null;
  nodeStatus?: string | null;
  lastSeenAt?: Date | null;
  masternodeProTxHash?: string | null;
  masternodeStatus?: string | null;
};

type InventoryRow = {
  nodeKey: string;
  ip: string;
  port: number;
  sources: InventorySource[];
  labels: string[];
  walletVersion: string | null;
  versionObservedAt: Date | null;
  protocolVersion: number | null;
  blockHeight: number | null;
  bestBlockHash: string | null;
  connections: number | null;
  syncProgress: number | null;
  nodeStatus: string | null;
  chainStatus: InventoryChainStatus;
  blocksDelta: number | null;
  masternodeProTxHash: string | null;
  masternodeStatus: string | null;
  lastSeenAt: Date | null;
};

const SOURCE_LABELS: Record<InventorySource, string> = {
  seed_node: 'Seed node',
  dns_seeder: 'DNS Seeder',
  pre_release: 'Test nodes API',
  direct_peer: 'Direct peer',
  masternode_rpc: 'Masternode RPC',
};

const SOURCE_WEIGHT: Record<InventorySource, number> = {
  pre_release: 50,
  seed_node: 45,
  direct_peer: 35,
  dns_seeder: 25,
  masternode_rpc: 10,
};

const STALE_AFTER_MS = 15 * 60_000;
const DRIFT_THRESHOLD = 2;

function normalizeIp(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

function parsePeerHost(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const bracketed = value.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed) return normalizeIp(bracketed[1]);
  const lastColon = value.lastIndexOf(':');
  if (lastColon > -1 && value.indexOf(':') === lastColon) return normalizeIp(value.slice(0, lastColon));
  return normalizeIp(value);
}

export function normalizeWalletVersion(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const normalized = value
    .replace(/^\/+|\/+$/g, '')
    .replace(/^DeFCoN:/i, '')
    .replace(/^Dash Core:/i, '')
    .trim();
  return normalized || null;
}

function parseNonNegativeInt(raw: unknown): number | null {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const value = raw > 1_000_000_000_000 ? raw : raw * 1000;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const date = new Date(raw);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function nodeKey(ip: string, port: number): string {
  return `${ip}:${port}`;
}

function classifyChain(
  height: number | null,
  hash: string | null,
  referenceHeight: number | null,
  referenceHash: string | null
): { chainStatus: InventoryChainStatus; blocksDelta: number | null } {
  if (height == null || referenceHeight == null) return { chainStatus: 'unknown', blocksDelta: null };
  const blocksDelta = height - referenceHeight;
  if (hash && referenceHash && hash === referenceHash) {
    return { chainStatus: 'main_chain', blocksDelta };
  }
  if (hash && referenceHash && height === referenceHeight && hash !== referenceHash) {
    return { chainStatus: 'hash_mismatch', blocksDelta };
  }
  if (blocksDelta > DRIFT_THRESHOLD) return { chainStatus: 'ahead', blocksDelta };
  if (blocksDelta < -DRIFT_THRESHOLD) return { chainStatus: 'behind', blocksDelta };
  return { chainStatus: 'unknown', blocksDelta };
}

function firstKnown<T>(rows: InventoryCandidate[], selector: (row: InventoryCandidate) => T | null | undefined): T | null {
  for (const row of rows) {
    const value = selector(row);
    if (value != null) return value;
  }
  return null;
}

function sourceRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (payload && typeof payload === 'object') {
    const row = payload as { data?: unknown; nodes?: unknown };
    if (Array.isArray(row.data)) return row.data as Array<Record<string, unknown>>;
    if (Array.isArray(row.nodes)) return row.nodes as Array<Record<string, unknown>>;
  }
  return [];
}

function sourceName(source: InventorySource): string {
  return SOURCE_LABELS[source];
}

// External crawler feeds are optional. An empty URL means the operator has not
// configured that feed, so it contributes no rows and is not polled or logged.
async function fetchFeed(url: string, apiKey = ''): Promise<unknown> {
  if (!url) return null;
  const response = await axios.get(url, {
    timeout: config.nodeInventory.requestTimeoutMs,
    headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
  });
  return response.data;
}

class NodeInventoryService {
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    // Let the seed-node and network-health snapshots establish their initial baseline first.
    await new Promise<void>((resolve) => setTimeout(resolve, 15_000));
    await this.poll();
    this.intervalId = setInterval(() => {
      this.poll().catch((error) => logger.error('Node inventory scanner failed:', error));
    }, config.nodeInventory.pollIntervalMs);
    logger.info(`Node inventory scanner started (${config.nodeInventory.pollIntervalMs / 1000}s interval)`);
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    this.isRunning = false;
  }

  async poll(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collectAndPersist().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async collectAndPersist(): Promise<void> {
    const now = new Date();
    const candidates: InventoryCandidate[] = [];

    const chainInfoPromise = rpcService.getBlockchainInfo() as Promise<BlockchainInfo>;
    const peersPromise = rpcService.getPeerInfo() as Promise<PeerInfo[]>;
    const masternodesPromise = getEnrichedNodes();
    const dnsPromise = fetchFeed(config.nodeInventory.dnsSeederApiUrl);
    const preReleasePromise = fetchFeed(
      config.nodeInventory.preReleaseNodesApiUrl,
      config.nodeInventory.preReleaseNodesApiKey
    );

    const [chainResult, peerResult, masternodeResult, dnsResult, preReleaseResult] = await Promise.allSettled([
      chainInfoPromise,
      peersPromise,
      masternodesPromise,
      dnsPromise,
      preReleasePromise,
    ]);

    const chainInfo = chainResult.status === 'fulfilled' ? chainResult.value : null;
    const referenceHeight = typeof chainInfo?.blocks === 'number' ? chainInfo.blocks : null;
    const referenceHash = String(chainInfo?.bestblockhash || '').trim() || null;

    for (const seed of seedNodeService.getReport()) {
      if (!seed.reachable || isIP(seed.ip) === 0) continue;
      candidates.push({
        ip: seed.ip,
        port: 8192,
        source: 'seed_node',
        label: seed.label,
        walletVersion: normalizeWalletVersion(seed.version),
        blockHeight: typeof seed.blockHeight === 'number' ? seed.blockHeight : null,
        bestBlockHash: seed.bestBlockHash || null,
        connections: typeof seed.connections === 'number' ? seed.connections : null,
        nodeStatus: seed.daemonRunning === false ? 'offline' : 'online',
        lastSeenAt: parseDate(seed.updatedAt) ?? new Date(seed.fetchedAt),
      });
    }

    if (peerResult.status === 'fulfilled') {
      for (const peer of peerResult.value || []) {
        const ip = parsePeerHost(peer.addr);
        if (!ip || isIP(ip) === 0) continue;
        const syncedHeight = Math.max(0, peer.synced_headers ?? 0, peer.synced_blocks ?? 0);
        candidates.push({
          ip,
          port: 8192,
          source: 'direct_peer',
          walletVersion: normalizeWalletVersion(peer.subver),
          protocolVersion: typeof peer.version === 'number' ? peer.version : null,
          // -1 is the daemon's "not reported" sentinel, not a chain height.
          blockHeight: syncedHeight > 0 ? syncedHeight : null,
          connections: 1,
          nodeStatus: 'connected',
          lastSeenAt: now,
        });
      }
    }

    if (masternodeResult.status === 'fulfilled') {
      for (const node of masternodeResult.value) {
        if (!node.ip || isIP(node.ip) === 0) continue;
        candidates.push({
          ip: node.ip,
          port: node.port ?? 8192,
          source: 'masternode_rpc',
          // protx state.version is the deterministic-MN record format, not a
          // wallet/protocol version. Only direct peers and external monitors
          // are trusted version sources.
          masternodeProTxHash: node.proTxHash,
          masternodeStatus: node.status,
          nodeStatus: node.status,
          lastSeenAt: node.lastSeen ? new Date(node.lastSeen * 1000) : now,
        });
      }
    }

    if (dnsResult.status === 'fulfilled') {
      for (const row of sourceRows(dnsResult.value)) {
        const ip = normalizeIp(row.ip);
        const port = parseNonNegativeInt(row.port) ?? 8192;
        if (!ip || isIP(ip) === 0 || port < 1 || port > 65535) continue;
        candidates.push({
          ip,
          port,
          source: 'dns_seeder',
          walletVersion: normalizeWalletVersion(row.version ?? row.wallet_version ?? row.walletVersion ?? row.subver),
          protocolVersion: parseNonNegativeInt(row.protocol_version ?? row.protocolVersion ?? row.protocol),
          blockHeight: parseNonNegativeInt(row.block_height ?? row.blockHeight ?? row.height ?? row.blocks),
          bestBlockHash: String(row.best_hash ?? row.bestBlockHash ?? row.best_block_hash ?? row.hash ?? '').trim() || null,
          connections: parseNonNegativeInt(row.connections ?? row.peer_count ?? row.peerCount ?? row.peers),
          lastSeenAt: parseDate(row.last_seen ?? row.lastSeen) ?? now,
        });
      }
    } else {
      logger.debug('Node inventory scanner: DNS seeder source unavailable');
    }

    if (preReleaseResult.status === 'fulfilled') {
      for (const row of sourceRows(preReleaseResult.value)) {
        const ip = normalizeIp(row.ip);
        const port = parseNonNegativeInt(row.port) ?? 8192;
        if (!ip || isIP(ip) === 0 || port < 1 || port > 65535) continue;
        candidates.push({
          ip,
          port,
          source: 'pre_release',
          label: String(row.node_name ?? row.nodeName ?? row.label ?? '').trim() || null,
          walletVersion: normalizeWalletVersion(row.version ?? row.wallet_version ?? row.walletVersion ?? row.subver),
          protocolVersion: parseNonNegativeInt(row.protocol_version ?? row.protocolVersion ?? row.protocol),
          blockHeight: parseNonNegativeInt(row.block_height ?? row.blockHeight ?? row.height),
          bestBlockHash: String(row.best_hash ?? row.bestHash ?? row.best_block_hash ?? row.bestBlockHash ?? row.hash ?? '').trim() || null,
          connections: parseNonNegativeInt(row.connections ?? row.peer_count ?? row.peerCount ?? row.peers),
          syncProgress: Number.isFinite(Number(row.sync_progress ?? row.syncProgress))
            ? Number(row.sync_progress ?? row.syncProgress)
            : null,
          nodeStatus: String(row.status ?? row.state ?? '').trim() || null,
          lastSeenAt: parseDate(row.checked_at ?? row.checkedAt ?? row.last_seen ?? row.lastSeen) ?? now,
        });
      }
    } else {
      logger.debug('Node inventory scanner: monitored test node source unavailable');
    }

    const grouped = new Map<string, InventoryCandidate[]>();
    for (const candidate of candidates) {
      const key = nodeKey(candidate.ip, candidate.port);
      const existing = grouped.get(key) ?? [];
      existing.push(candidate);
      grouped.set(key, existing);
    }

    const rows: InventoryRow[] = [];
    for (const [key, group] of grouped) {
      const ordered = [...group].sort((a, b) => SOURCE_WEIGHT[b.source] - SOURCE_WEIGHT[a.source]);
      const ip = ordered[0].ip;
      const port = ordered[0].port;
      const height = firstKnown(ordered, (row) => row.blockHeight);
      const hash = firstKnown(ordered, (row) => row.bestBlockHash);
      // DNS seeder rows are intentionally a broad discovery snapshot. Their
      // height can be stale and, without a hash, cannot prove a chain branch.
      // Only a direct peer, seed endpoint, or monitored full node may label a
      // node as ahead/behind; DNS-only rows remain "hash unknown".
      const chainCandidate = ordered.find(
        (row) =>
          Boolean(row.bestBlockHash) ||
          (row.blockHeight != null && row.source !== 'dns_seeder' && row.source !== 'masternode_rpc')
      );
      const classification = chainCandidate
        ? classifyChain(chainCandidate.blockHeight ?? null, chainCandidate.bestBlockHash ?? null, referenceHeight, referenceHash)
        : { chainStatus: 'unknown' as const, blocksDelta: null };
      const lastSeenAt = ordered
        .map((row) => row.lastSeenAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

      rows.push({
        nodeKey: key,
        ip,
        port,
        sources: Array.from(new Set(ordered.map((row) => row.source))),
        labels: Array.from(new Set(ordered.map((row) => row.label).filter((value): value is string => Boolean(value)))),
        walletVersion: firstKnown(ordered, (row) => row.walletVersion),
        versionObservedAt: ordered.find((row) => row.walletVersion != null)?.lastSeenAt ?? null,
        protocolVersion: firstKnown(ordered, (row) => row.protocolVersion),
        blockHeight: height,
        bestBlockHash: hash,
        connections: firstKnown(ordered, (row) => row.connections),
        syncProgress: firstKnown(ordered, (row) => row.syncProgress),
        nodeStatus: firstKnown(ordered, (row) => row.nodeStatus),
        chainStatus: classification.chainStatus,
        blocksDelta: classification.blocksDelta,
        masternodeProTxHash: firstKnown(ordered, (row) => row.masternodeProTxHash),
        masternodeStatus: firstKnown(ordered, (row) => row.masternodeStatus),
        lastSeenAt,
      });
    }

    if (rows.length === 0) {
      logger.debug('Node inventory scanner: no source rows collected');
      return;
    }

    const existingDocs = await NodeInventory.find(
      { nodeKey: { $in: rows.map((row) => row.nodeKey) } },
      { nodeKey: 1, walletVersion: 1, lastVersionObservedAt: 1, chainStatus: 1 }
    ).lean();
    const existingByKey = new Map(existingDocs.map((doc) => [doc.nodeKey, doc]));

    // A masternode RPC knows about registered endpoints but does not provide the
    // daemon's wallet version. Keep the latest version reported by a source that
    // can actually identify it instead of replacing it with null on every poll.
    const persistedRows = rows.map((row) => {
      const previous = existingByKey.get(row.nodeKey);
      const walletVersion = row.walletVersion ?? previous?.walletVersion ?? null;
      const lastVersionObservedAt = row.walletVersion
        ? (row.versionObservedAt ?? now)
        : (previous?.lastVersionObservedAt ?? null);

      return {
        ...row,
        walletVersion,
        lastVersionObservedAt,
      };
    });

    const updates = persistedRows.map(({ versionObservedAt: _versionObservedAt, ...row }) => ({
      updateOne: {
        filter: { nodeKey: row.nodeKey },
        update: {
          $setOnInsert: { firstSeenAt: now },
          $set: {
            ...row,
            sources: row.sources.map(sourceName),
            lastObservedAt: now,
          },
        },
        upsert: true,
      },
    }));
    await NodeInventory.bulkWrite(updates, { ordered: false });

    const events = persistedRows.flatMap((row) => {
      const previous = existingByKey.get(row.nodeKey);
      if (!previous) {
        return [{
          nodeKey: row.nodeKey,
          ip: row.ip,
          port: row.port,
          eventType: 'discovered',
          walletVersion: row.walletVersion,
          chainStatus: row.chainStatus,
          blockHeight: row.blockHeight,
          bestBlockHash: row.bestBlockHash,
          sources: row.sources.map(sourceName),
        }];
      }
      // Only an actual version-bearing source can create a version change. A
      // missing version is not a downgrade and must never create a false event.
      if (row.walletVersion != null && (previous.walletVersion ?? null) !== row.walletVersion) {
        return [{
          nodeKey: row.nodeKey,
          ip: row.ip,
          port: row.port,
          eventType: 'version_changed',
          previousVersion: previous.walletVersion ?? null,
          walletVersion: row.walletVersion,
          previousChainStatus: previous.chainStatus ?? null,
          chainStatus: row.chainStatus,
          blockHeight: row.blockHeight,
          bestBlockHash: row.bestBlockHash,
          sources: row.sources.map(sourceName),
        }];
      }
      if ((previous.chainStatus ?? 'unknown') !== row.chainStatus) {
        return [{
          nodeKey: row.nodeKey,
          ip: row.ip,
          port: row.port,
          eventType: 'chain_changed',
          previousVersion: previous.walletVersion ?? null,
          walletVersion: row.walletVersion,
          previousChainStatus: previous.chainStatus ?? null,
          chainStatus: row.chainStatus,
          blockHeight: row.blockHeight,
          bestBlockHash: row.bestBlockHash,
          sources: row.sources.map(sourceName),
        }];
      }
      return [];
    });

    if (events.length > 0) {
      await NodeInventoryEvent.insertMany(events, { ordered: false });
    }
    logger.debug(`Node inventory scanner: stored ${rows.length} node records, ${events.length} change event(s)`);
  }
}

export const nodeInventoryService = new NodeInventoryService();
export { STALE_AFTER_MS };
