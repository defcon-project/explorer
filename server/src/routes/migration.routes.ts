import { Router, Request, Response } from 'express';
import { Transaction } from '../models/Transaction';
import { getChainTip } from '../services/chainTip.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { satToBigInt, satToCoin, type SatLike } from '../utils/amounts';
import {
  firstValidationIssueMessage,
  parseLatestCountQuery,
  sendInternalError,
  sendValidationError,
} from '../utils/validation';

const router = Router();

const HOT_WALLET_ADDRESS = config.migration.hotWalletAddress;
// Additional wallet-owned addresses (HD change addresses etc.) can be listed as
// MIGRATION_HOT_WALLET_ADDRESSES=addr1,addr2 in the environment.
const EXTRA_WALLET_ADDRESSES: ReadonlySet<string> = new Set(
  config.migration.extraHotWalletAddresses
);

const DEBUG_MIGRATION = config.nodeEnv !== 'production';
const DEFAULT_COUNT = 100;
const MAX_SCAN_MULTIPLIER = 12;
const MAX_SCAN_LIMIT = 5000;
const TRANSPARENCY_TTL_MS = Math.max(1000, Math.min(30_000, config.cache.ttlSeconds * 1000));

type VinEntry = { address?: string };
type VoutEntry = { valueSat?: SatLike; scriptPubKey?: { addresses?: unknown } };

type OutgoingRecord = {
  txid: string;
  vout: number;
  blockheight: number;
  blocktime: number;
  confirmations: number;
  toAddress: string;
  amount: number;
  amountSat: string;
};

type CachedResponse = {
  atMs: number;
  payload: {
    success: true;
    data: {
      hotWalletAddress: string;
      generatedAt: string;
      windowCount: number;
      summary: {
        outgoingTxCount: number;
        outgoingTransferCount: number;
        totalOutgoing: number;
        totalOutgoingSat: string;
        uniqueRecipients: number;
        lastPayoutAt: number | null;
      };
      items: OutgoingRecord[];
    };
  };
};

const transparencyCache = new Map<number, CachedResponse>();

/** Exposed for testing only – clears the in-memory transparency cache. */
export function clearTransparencyCache(): void {
  transparencyCache.clear();
}

/**
 * Build the set of wallet-owned addresses for a single transaction.
 * Any address that the wallet used as an INPUT is wallet-owned (the wallet
 * must hold its private key to sign). We add those plus all explicitly
 * configured extra addresses, so change outputs sent to HD-wallet change
 * addresses are correctly excluded.
 */
function buildOwnedSet(vinEntries: VinEntry[]): Set<string> {
  const owned = new Set<string>([HOT_WALLET_ADDRESS, ...EXTRA_WALLET_ADDRESSES]);
  for (const vin of vinEntries) {
    if (typeof vin.address === 'string' && vin.address) owned.add(vin.address);
  }
  return owned;
}

/**
 * Return the first external (non-wallet-owned) address from a vout's address
 * list, or null if all addresses belong to the wallet.
 */
function externalAddress(addresses: unknown, owned: Set<string>): string | null {
  if (!Array.isArray(addresses)) return null;
  for (const value of addresses) {
    if (typeof value === 'string' && !owned.has(value)) return value;
  }
  return null;
}

router.get('/transparency', async (req: Request, res: Response) => {
  try {
    const countParsed = parseLatestCountQuery(req.query as Record<string, unknown>, DEFAULT_COUNT);
    if (!countParsed.success) {
      return sendValidationError(res, firstValidationIssueMessage(countParsed.error));
    }

    const { count } = countParsed.data;
    const now = Date.now();
    const cached = transparencyCache.get(count);
    if (cached && now - cached.atMs < TRANSPARENCY_TTL_MS) {
      return res.json(cached.payload);
    }

    const scanLimit = Math.min(MAX_SCAN_LIMIT, Math.max(count, count * MAX_SCAN_MULTIPLIER));
    const [tip, txs] = await Promise.all([
      getChainTip(),
      Transaction.find({ 'vin.address': HOT_WALLET_ADDRESS })
        .sort({ blockheight: -1, _id: -1 })
        .limit(scanLimit)
        .select({
          txid: 1,
          blockheight: 1,
          blocktime: 1,
          vin: 1,
          vout: 1,
        })
        .lean(),
    ]);

    const records: OutgoingRecord[] = [];
    // Track unique txid+vout-index pairs to prevent double-counting.
    const seenOutputKeys = new Set<string>();
    // Track unique txids that have at least one valid payout output.
    const payoutTxIds = new Set<string>();
    const recipientSet = new Set<string>();
    let totalOutgoingSat = 0n;

    for (const tx of txs) {
      const txid = typeof tx.txid === 'string' ? tx.txid : '';
      const blockheight = typeof tx.blockheight === 'number' ? tx.blockheight : 0;
      const blocktime = typeof tx.blocktime === 'number' ? tx.blocktime : 0;
      const confirmations = Math.max(0, tip.height - blockheight + 1);
      const outputs = Array.isArray(tx.vout) ? (tx.vout as VoutEntry[]) : [];
      const inputs = Array.isArray(tx.vin) ? (tx.vin as VinEntry[]) : [];

      // Build the owned-address set for THIS tx using its actual input addresses.
      const owned = buildOwnedSet(inputs);

      for (let voutIndex = 0; voutIndex < outputs.length; voutIndex++) {
        const output = outputs[voutIndex];
        const outputKey = `${txid}:${voutIndex}`;
        if (seenOutputKeys.has(outputKey)) continue;

        const toAddress = externalAddress(output.scriptPubKey?.addresses, owned);
        if (!toAddress) {
          // Change or OP_RETURN – skip and log in dev mode.
          if (DEBUG_MIGRATION) {
            const addrs = Array.isArray(output.scriptPubKey?.addresses)
              ? (output.scriptPubKey!.addresses as unknown[]).join(',')
              : '(none)';
            logger.debug(`Migration: excluded vout[${voutIndex}] txid=${txid} addr=${addrs} (change/owned)`);
          }
          continue;
        }

        const amountSat = satToBigInt(output.valueSat);
        if (amountSat <= 0n) continue;

        seenOutputKeys.add(outputKey);
        payoutTxIds.add(txid);
        recipientSet.add(toAddress);
        totalOutgoingSat += amountSat;

        records.push({
          txid,
          vout: voutIndex,
          blockheight,
          blocktime,
          confirmations,
          toAddress,
          amount: satToCoin(amountSat),
          amountSat: amountSat.toString(),
        });

        // One payout row per transaction: remaining outputs are either change or
        // OP_RETURN. Break here so HD-wallet change addresses (fresh, never seen
        // as inputs) never appear as extra payout rows.
        break;
      }

      if (records.length >= count) break;

      if (records.length >= count) break;
    }

    const payload = {
      success: true as const,
      data: {
        hotWalletAddress: HOT_WALLET_ADDRESS,
        generatedAt: new Date().toISOString(),
        windowCount: count,
        summary: {
          outgoingTxCount: payoutTxIds.size,
          outgoingTransferCount: records.length,
          totalOutgoing: satToCoin(totalOutgoingSat),
          totalOutgoingSat: totalOutgoingSat.toString(),
          uniqueRecipients: recipientSet.size,
          lastPayoutAt: records[0]?.blocktime ?? null,
        },
        items: records,
      },
    };

    transparencyCache.set(count, { atMs: now, payload });
    res.json(payload);
  } catch (error) {
    sendInternalError(res, 'Failed to fetch migration transparency data', error);
  }
});

export default router;
