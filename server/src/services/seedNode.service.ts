import axios from 'axios';
import { logger } from '../utils/logger';

// -- Hardcoded seed nodes --

// Must match chainparams_seed_main in the node's chainparamsseeds.h (v23: three seeds).
const SEED_NODES = [
  { ip: '154.12.247.198', label: 'Seed 1' },
  { ip: '154.12.247.214', label: 'Seed 2' },
  { ip: '154.26.155.66', label: 'Seed 3' },
] as const;

const POLL_INTERVAL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const BLOCK_HASH_PATTERN = /^[0-9a-f]{64}$/i;
/**
 * Seed responses are sampled independently, so a freshly mined block can land
 * between two responses and leave them a block or two apart. That is propagation
 * lag, not a fork. A gap wider than this is treated as divergence, because a
 * seed that far out of step is a genuine problem.
 */
const SEED_LAG_TOLERANCE_BLOCKS = 3;

function normalizeBlockHash(value: unknown): string | undefined {
  const hash = typeof value === 'string' ? value.trim() : '';
  return BLOCK_HASH_PATTERN.test(hash) ? hash : undefined;
}

/**
 * Creates a comparison baseline from the hardcoded bootstrap seeds.
 *
 * Divergence is claimed only on real evidence: two reachable seeds reporting
 * different block hashes at the same height, or tips further apart than
 * SEED_LAG_TOLERANCE_BLOCKS. Seeds one block apart are ordinary propagation
 * lag and keep a usable baseline.
 */
export function classifySeedBaseline(observations: SeedNodeStatus[]): SeedNodeStatus[] {
  const comparable = observations.filter(
    (node) =>
      node.reachable &&
      typeof node.blockHeight === 'number' &&
      Number.isFinite(node.blockHeight) &&
      Boolean(node.bestBlockHash)
  );

  // Real fork evidence is two seeds reporting DIFFERENT hashes AT THE SAME
  // HEIGHT. Differing heights alone prove nothing (see SEED_LAG_TOLERANCE_BLOCKS).
  const hashesByHeight = new Map<number, Set<string>>();
  for (const node of comparable) {
    const hashes = hashesByHeight.get(node.blockHeight!) ?? new Set<string>();
    hashes.add(node.bestBlockHash!);
    hashesByHeight.set(node.blockHeight!, hashes);
  }
  const hasHashConflict = [...hashesByHeight.values()].some((hashes) => hashes.size > 1);

  const heights = comparable.map((node) => node.blockHeight!);
  const spread = heights.length ? Math.max(...heights) - Math.min(...heights) : 0;
  // Every seed passed in must be comparable. The poller passes exactly one
  // observation per SEED_NODES entry, so this is the full seed set in production.
  const hasConsensus =
    comparable.length === observations.length &&
    !hasHashConflict &&
    spread <= SEED_LAG_TOLERANCE_BLOCKS;

  // Baseline = the most advanced tip among seeds that are demonstrably on one chain.
  const leader = hasConsensus
    ? comparable.reduce((best, node) => (node.blockHeight! > best.blockHeight! ? node : best))
    : null;
  const baselineHeight = leader ? leader.blockHeight! : null;
  const baselineHash = leader ? leader.bestBlockHash! : null;

  return observations.map((node) => {
    if (!node.reachable || node.blockHeight == null || !node.bestBlockHash) {
      return { ...node, chainStatus: 'not-comparable', blocksDelta: undefined };
    }

    if (comparable.length < observations.length) {
      return { ...node, chainStatus: 'not-comparable', blocksDelta: undefined };
    }

    if (!hasConsensus || baselineHeight == null || !baselineHash) {
      return { ...node, chainStatus: 'seed-divergence', blocksDelta: undefined };
    }

    const blocksDelta = node.blockHeight - baselineHeight;
    if (node.bestBlockHash === baselineHash && blocksDelta === 0) {
      return { ...node, chainStatus: 'seed-baseline', blocksDelta: 0 };
    }
    if (blocksDelta === 0) {
      return { ...node, chainStatus: 'hash-mismatch', blocksDelta };
    }
    return {
      ...node,
      chainStatus: blocksDelta > 0 ? 'ahead' : 'behind',
      blocksDelta,
    };
  });
}

// -- Raw API shape returned by each seed node --

interface SeedNodeRaw {
  hostname?: string;
  updatedAt?: string;
  status?: string;
  daemonRunning?: boolean;
  blockHeight?: number;
  bestBlockHash?: string;
  connections?: number;
  version?: string;
  warnings?: string;
}

// -- Public types --

export type SeedChainStatus =
  | 'seed-baseline'
  | 'seed-divergence'
  | 'hash-mismatch'
  | 'behind'
  | 'ahead'
  | 'not-comparable';

export interface SeedNodeStatus {
  ip: string;
  label: string;
  reachable: boolean;
  fetchedAt: number;
  hostname?: string;
  /** ISO timestamp from the seed node's own clock */
  updatedAt?: string;
  daemonRunning?: boolean;
  status?: string;
  blockHeight?: number;
  bestBlockHash?: string;
  connections?: number;
  version?: string;
  warnings?: string;
  /** How this seed compares to the agreed hardcoded-seed baseline. */
  chainStatus: SeedChainStatus;
  /** Positive = node is ahead, negative = node is behind (in blocks). */
  blocksDelta?: number;
  error?: string;
}

// -- Service class --

class SeedNodeService {
  private report: SeedNodeStatus[] = [];
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    // Small delay so networkHealthService can complete its initial poll first
    await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    try {
      await this.poll();
    } catch (err) {
      logger.warn('SeedNode: initial poll failed, will retry:', err);
    }
    this.intervalId = setInterval(() => {
      this.poll().catch((err) => logger.error('SeedNode poller error:', err));
    }, POLL_INTERVAL_MS);
    logger.info(`SeedNode poller started (${POLL_INTERVAL_MS / 1000}s interval)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('SeedNode poller stopped');
  }

  getReport(): SeedNodeStatus[] {
    return this.report;
  }

  private async poll(): Promise<void> {
    const results = await Promise.allSettled(
      SEED_NODES.map(({ ip, label }) => this.fetchOne(ip, label))
    );

    const observations = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const { ip, label } = SEED_NODES[i];
      return {
        ip,
        label,
        reachable: false,
        fetchedAt: Date.now(),
        chainStatus: 'not-comparable' as const,
        error: String(r.reason),
      };
    });

    this.report = this.applySeedBaseline(observations);
  }

  /**
   * A static seed is a bootstrap source, not proof of the canonical chain.
   * A small tip gap is tolerated as normal propagation lag; a seed baseline
   * still does not prove the canonical chain.
   */
  private applySeedBaseline(observations: SeedNodeStatus[]): SeedNodeStatus[] {
    return classifySeedBaseline(observations);
  }

  private async fetchOne(ip: string, label: string): Promise<SeedNodeStatus> {
    const url = `http://${ip}/api/seed-status.json`;
    try {
      const { data } = await axios.get<SeedNodeRaw>(url, { timeout: FETCH_TIMEOUT_MS });

      return {
        ip,
        label,
        reachable: true,
        fetchedAt: Date.now(),
        hostname: data.hostname,
        updatedAt: data.updatedAt,
        daemonRunning: data.daemonRunning,
        status: data.status,
        blockHeight: data.blockHeight,
        bestBlockHash: normalizeBlockHash(data.bestBlockHash),
        connections: data.connections,
        version: data.version,
        warnings: data.warnings,
        chainStatus: 'not-comparable',
      };
    } catch (err) {
      const errorMsg = axios.isAxiosError(err)
        ? `${err.code ?? 'ERR'}: ${err.message}`
        : String(err);
      return {
        ip,
        label,
        reachable: false,
        fetchedAt: Date.now(),
        chainStatus: 'not-comparable',
        error: errorMsg,
      };
    }
  }
}

export const seedNodeService = new SeedNodeService();
