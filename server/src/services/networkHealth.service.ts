import { rpcService } from './rpc.service';
import { logger } from '../utils/logger';

// ── RPC raw types ────────────────────────────────────────────────────────────

interface RpcChainTip {
  height: number;
  hash: string;
  branchlen: number;
  status: 'active' | 'valid-fork' | 'valid-headers' | 'invalid' | 'unknown' | 'conflicting';
}

interface RpcBlockchainInfo {
  blocks?: number;
  headers?: number;
  verificationprogress?: number;
  bestblockhash?: string;
  chainwork?: string;
}

interface RpcPeerInfo {
  addr?: string;
  synced_headers?: number;
  synced_blocks?: number;
  banscore?: number;
  inbound?: boolean;
}

// ── Public types (exported for use in routes + client types) ─────────────────

export type ChainTipStatus = 'active' | 'valid-fork' | 'valid-headers' | 'invalid' | 'unknown' | 'conflicting';
export type NetworkHealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface ChainTipInfo {
  height: number;
  hash: string;
  branchlen: number;
  status: ChainTipStatus;
  /** Peer IPs whose synced_headers matches this tip height (empty for active tip) */
  peerIPs: string[];
}

export interface PeerSummary {
  total: number;
  inbound: number;
  outbound: number;
  maxBanscore: number;
  bannedCount: number;
  behindCount: number;
  avgSyncedHeaders: number;
  behindPeerList: Array<{ ip: string; syncedHeaders: number }>;
}

export interface ChainSyncInfo {
  blocks: number;
  headers: number;
  verificationProgress: number;
  isSynced: boolean;
  blocksBehind: number;
}

export interface NetworkHealthReport {
  status: NetworkHealthStatus;
  statusReason: string;
  checkedAt: number;
  activeTip: ChainTipInfo | null;
  chainTips: ChainTipInfo[];
  forkCount: number;
  invalidCount: number;
  sync: ChainSyncInfo;
  peers: PeerSummary;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip port suffix from peer addr (handles both IPv4 and IPv6 bracket notation) */
function stripPort(addr: string): string {
  if (addr.startsWith('[')) {
    // IPv6: [::1]:8192 → ::1
    return addr.replace(/^\[(.+)\]:\d+$/, '$1');
  }
  // IPv4: 192.0.2.4:8192 → 192.0.2.4
  return addr.replace(/:\d+$/, '');
}

// ── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;
const BANSCORE_WARN_THRESHOLD = 1;
const PEER_BEHIND_BLOCKS = 5;
const MIN_HEALTHY_PEERS = 3;
const SYNC_PROGRESS_THRESHOLD = 0.9999;

// ── Status computation ───────────────────────────────────────────────────────

function computeStatus(
  report: Omit<NetworkHealthReport, 'status' | 'statusReason'>
): { status: NetworkHealthStatus; statusReason: string } {
  if (report.forkCount > 0) {
    return {
      status: 'critical',
      statusReason: `${report.forkCount} active fork branch${report.forkCount > 1 ? 'es' : ''} detected`,
    };
  }
  if (report.invalidCount > 0) {
    return {
      status: 'warning',
      statusReason: `${report.invalidCount} invalid chain tip${report.invalidCount > 1 ? 's' : ''} known`,
    };
  }
  if (!report.sync.isSynced && report.sync.blocksBehind > 10) {
    return {
      status: 'warning',
      statusReason: `Node is ${report.sync.blocksBehind} blocks behind validated headers`,
    };
  }
  if (report.peers.total < MIN_HEALTHY_PEERS) {
    return { status: 'warning', statusReason: `Low peer count: ${report.peers.total}` };
  }
  if (report.peers.bannedCount > 0) {
    return {
      status: 'warning',
      statusReason: `${report.peers.bannedCount} peer${report.peers.bannedCount > 1 ? 's' : ''} with non-zero banscore`,
    };
  }
  return { status: 'healthy', statusReason: 'All chain tips consistent, sync OK' };
}

// ── Service class ────────────────────────────────────────────────────────────

class NetworkHealthService {
  private report: NetworkHealthReport | null = null;
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await this.poll();
    } catch (err) {
      logger.warn('NetworkHealth: initial poll failed, will retry on next interval:', err);
    }

    this.intervalId = setInterval(() => {
      this.poll().catch((err) => logger.error('NetworkHealth poller error:', err));
    }, POLL_INTERVAL_MS);

    logger.info(`NetworkHealth poller started (${POLL_INTERVAL_MS / 1000}s interval)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('NetworkHealth poller stopped');
  }

  getReport(): NetworkHealthReport | null {
    return this.report;
  }

  private async poll(): Promise<void> {
    const [rawTips, rawChainInfo, rawPeers] = await Promise.all([
      rpcService.call<RpcChainTip[]>('getchaintips'),
      rpcService.getBlockchainInfo() as Promise<RpcBlockchainInfo>,
      rpcService.getPeerInfo() as Promise<RpcPeerInfo[]>,
    ]);

    // Build height → peer IPs map
    const peersByHeight = new Map<number, string[]>();
    for (const p of rawPeers ?? []) {
      if (p.addr && typeof p.synced_headers === 'number') {
        const ip = stripPort(p.addr);
        const list = peersByHeight.get(p.synced_headers) ?? [];
        list.push(ip);
        peersByHeight.set(p.synced_headers, list);
      }
    }

    // Chain tips
    const chainTips: ChainTipInfo[] = (rawTips ?? []).map((t) => ({
      height: t.height,
      hash: t.hash,
      branchlen: t.branchlen,
      status: t.status,
      peerIPs: t.status !== 'active' ? (peersByHeight.get(t.height) ?? []) : [],
    }));

    const activeTip = chainTips.find((t) => t.status === 'active') ?? null;
    const forkCount = chainTips.filter((t) => t.status === 'valid-fork').length;
    const invalidCount = chainTips.filter((t) => t.status === 'invalid').length;

    // Sync info
    const blocks = rawChainInfo?.blocks ?? 0;
    const headers = rawChainInfo?.headers ?? 0;
    const verificationProgress = rawChainInfo?.verificationprogress ?? 1;
    const blocksBehind = Math.max(0, headers - blocks);
    // verificationProgress on DeFCoN reports a non-standard value; use blocksBehind as primary signal
    const isSynced = blocksBehind <= 1 && blocks > 0;

    const sync: ChainSyncInfo = {
      blocks,
      headers,
      verificationProgress,
      isSynced,
      blocksBehind,
    };

    // Peer summary
    const peers = rawPeers ?? [];
    const tipHeight = activeTip?.height ?? blocks;
    const bannedPeers = peers.filter((p) => (p.banscore ?? 0) >= BANSCORE_WARN_THRESHOLD);
    const behindPeers = peers.filter(
      (p) => typeof p.synced_headers === 'number' && tipHeight - p.synced_headers > PEER_BEHIND_BLOCKS
    );
    const inboundCount = peers.filter((p) => p.inbound).length;
    const totalSyncedHeaders = peers.reduce((sum, p) => sum + (p.synced_headers ?? 0), 0);

    const peerSummary: PeerSummary = {
      total: peers.length,
      inbound: inboundCount,
      outbound: peers.length - inboundCount,
      maxBanscore: peers.length > 0 ? Math.max(0, ...peers.map((p) => p.banscore ?? 0)) : 0,
      bannedCount: bannedPeers.length,
      behindCount: behindPeers.length,
      avgSyncedHeaders: peers.length > 0 ? Math.round(totalSyncedHeaders / peers.length) : 0,
      behindPeerList: behindPeers.map((p) => ({
        ip: stripPort(p.addr ?? ''),
        syncedHeaders: p.synced_headers ?? 0,
      })),
    };

    const partial = {
      checkedAt: Date.now(),
      activeTip,
      chainTips,
      forkCount,
      invalidCount,
      sync,
      peers: peerSummary,
    };

    const { status, statusReason } = computeStatus(partial);
    this.report = { ...partial, status, statusReason };
  }
}

export const networkHealthService = new NetworkHealthService();
