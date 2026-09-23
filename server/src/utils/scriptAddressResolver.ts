import { config } from '../config';
import { logger } from './logger';
import { rpcService } from '../services/rpc.service';
import {
  extractPubkeyHexFromAsm,
  pubkeyHexToP2pkhAddress,
  tryGetBase58CheckVersionByte,
} from './addressEncoding';
import type { RpcBlock, RpcTransaction } from '../types/rpc';

/**
 * Handles P2PK-to-P2PKH address derivation for chains that produce legacy
 * pubkey outputs without embedded addresses. Manages version-byte inference,
 * an LRU-bounded pubkey→address cache, and ASM-based fallback derivation.
 */
export class ScriptAddressResolver {
  private inferredP2pkhVersionByte: number | null = null;
  private readonly pubkeyAddressCache = new Map<string, string>();
  private warnedP2pkhFallback = false;
  private readonly PUBKEY_CACHE_MAX = 10_000;

  private evictOldestPubkeyCacheEntry(): void {
    for (const key of this.pubkeyAddressCache.keys()) {
      this.pubkeyAddressCache.delete(key);
      break;
    }
  }

  getP2pkhVersionByte(): number {
    const configured = config.address.p2pkhVersionByte;
    if (
      typeof configured === 'number' &&
      Number.isInteger(configured) &&
      configured >= 0 &&
      configured <= 255
    ) {
      return configured;
    }

    if (this.inferredP2pkhVersionByte != null) return this.inferredP2pkhVersionByte;

    if (!this.warnedP2pkhFallback) {
      this.warnedP2pkhFallback = true;
      logger.warn(
        'P2PKH version byte is not configured and could not be inferred yet; defaulting to 30. Set P2PKH_VERSION env to override.'
      );
    }
    return 30; // DeFCoN default (addresses starting with "D")
  }

  maybeInferFromAddress(address: string): void {
    if (this.inferredP2pkhVersionByte != null) return;
    const inferred = tryGetBase58CheckVersionByte(address);
    if (inferred == null) return;

    this.inferredP2pkhVersionByte = inferred;
    logger.info(`Inferred P2PKH version byte: ${inferred}`);
  }

  /**
   * Best-effort scan of recent blocks to discover the chain's P2PKH prefix
   * before we start deriving legacy P2PK outputs into P2PKH-style addresses.
   */
  async preInferVersionByte(): Promise<void> {
    if (config.address.p2pkhVersionByte != null) return;
    if (this.inferredP2pkhVersionByte != null) return;

    try {
      const tip = await rpcService.getBlockCount();
      const scanWindow = Math.min(120, tip + 1);
      const sampleCount = Math.min(24, scanWindow);
      const stride = Math.max(1, Math.floor(scanWindow / sampleCount));
      const heights: number[] = [];
      for (let offset = 0; offset < scanWindow && heights.length < sampleCount; offset += stride) {
        heights.push(tip - offset);
      }
      const oldestHeight = Math.max(0, tip - (scanWindow - 1));
      if (!heights.includes(oldestHeight)) heights.push(oldestHeight);

      const blockBatchSize = 6;
      for (let i = 0; i < heights.length && this.inferredP2pkhVersionByte == null; i += blockBatchSize) {
        const batch = heights.slice(i, i + blockBatchSize);
        const blocks = await Promise.all(
          batch.map(async (height) => {
            try {
              const hash = await rpcService.getBlockHash(height);
              const block = (await rpcService.getBlock(hash, 1)) as RpcBlock;
              return { hash, block };
            } catch {
              return null;
            }
          })
        );

        for (const item of blocks) {
          if (!item || this.inferredP2pkhVersionByte != null) continue;

          const txids = (item.block.tx || []).filter((t): t is string => typeof t === 'string');
          const txs = await Promise.all(
            txids.slice(0, 4).map(async (txid) => {
              try {
                return (await rpcService.getRawTransaction(txid, true, item.hash)) as RpcTransaction;
              } catch {
                return null;
              }
            })
          );

          for (const tx of txs) {
            if (!tx) continue;
            for (const vout of tx.vout || []) {
              const spk = vout?.scriptPubKey;
              if (spk?.type === 'pubkeyhash' && typeof spk.address === 'string' && spk.address) {
                this.maybeInferFromAddress(spk.address);
                if (this.inferredP2pkhVersionByte != null) return;
              }
            }
          }
        }
      }
    } catch {
      // If this fails, we'll infer later or fall back to the default.
    }
  }

  /**
   * Derive a P2PKH address from a raw pubkey ASM script (fallback for outputs
   * where the daemon does not provide an address). Uses an LRU-bounded cache.
   */
  deriveAddressFromPubkeyAsm(asm: string): string | null {
    const pubkeyHex = extractPubkeyHexFromAsm(asm);
    if (!pubkeyHex) return null;

    const cached = this.pubkeyAddressCache.get(pubkeyHex);
    if (cached) {
      // Touch key for LRU ordering.
      this.pubkeyAddressCache.delete(pubkeyHex);
      this.pubkeyAddressCache.set(pubkeyHex, cached);
      return cached;
    }

    const derived = pubkeyHexToP2pkhAddress(pubkeyHex, this.getP2pkhVersionByte());
    if (this.pubkeyAddressCache.size >= this.PUBKEY_CACHE_MAX) {
      this.evictOldestPubkeyCacheEntry();
    }
    this.pubkeyAddressCache.set(pubkeyHex, derived);
    return derived;
  }
}
