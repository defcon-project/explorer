import { Block } from '../models/Block';

/**
 * Lightweight in-memory cache for the chain tip (latest block).
 * Eliminates 10+ redundant `Block.findOne().sort({height:-1})` DB calls
 * that previously ran on almost every API request.
 */

interface ChainTip {
  height: number;
  time: number;
  hash?: string;
}

let cached: { atMs: number; tip: ChainTip } | null = null;
let inFlight: Promise<ChainTip> | null = null;

const TTL_MS = 10_000; // 10 seconds — fresh enough for explorer, avoids DB spam

export async function getChainTip(): Promise<ChainTip> {
  const now = Date.now();
  if (cached && now - cached.atMs < TTL_MS) {
    return cached.tip;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const block = await Block.findOne()
      .sort({ height: -1 })
      .select({ height: 1, time: 1, hash: 1 })
      .lean<{ height: number; time: number; hash?: string }>();

    const tip: ChainTip = {
      height: block?.height ?? 0,
      time: block?.time ?? 0,
      hash: block?.hash,
    };

    cached = { atMs: now, tip };
    return tip;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Call after sync service indexes a new block to keep the tip fresh. */
export function invalidateChainTip(): void {
  cached = null;
  inFlight = null;
}
