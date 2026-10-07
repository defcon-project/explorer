import { z } from 'zod';
import { config } from '../config';
import { chainHashSchema, decodeCommitment, verifiedCommitmentMembers } from '../domain/pose/commitment';
import { emptyPenaltyAttribution, parsePenaltySnapshot, penaltyContextGap, replayPenaltyAttribution,
  type AttributionCommitment } from '../domain/pose/penaltyAttribution';
import { PoseChainBlock } from '../models/PoseChainBlock';
import { PoseChainState } from '../models/PoseChainState';
import { rpcService } from './rpc.service';
import { createSingleFlight } from '../utils/singleFlight';
import { PeriodicTask } from '../utils/periodicTask';
import { logger } from '../utils/logger';

const blockSchema = z.object({
  hash: chainHashSchema, height: z.number().int().nonnegative(), previousblockhash: chainHashSchema,
  time: z.number().int().nonnegative(),
  // A verbose block is required. Never silently skip txids-only responses.
  tx: z.array(z.object({ txid: chainHashSchema, type: z.number().int().optional(), extraPayload: z.string().optional(),
    vin: z.array(z.object({ coinbase: z.string().optional() })).optional(),
  })),
});
function attributionTransactionTypes(block: z.infer<typeof blockSchema>): number[] | null {
  // Existing mined fixtures are commitment extracts. Require full verbose-block
  // context (coinbase first) before claiming that no other state-changing tx exists.
  if (!block.tx[0]?.vin?.[0]?.coinbase || block.tx.slice(1).some((tx) => tx.vin?.some((input) => input.coinbase))) return null;
  return block.tx.map((tx) => tx.type ?? (tx.extraPayload ? -1 : 0));
}
type RpcReader = { call<T = unknown>(method: string, params?: unknown[]): Promise<T> };
type StoredCommitment = {
  txid: string; rawPayload: string; quorumType: number | null; quorumHash: string | null;
  quorumIndex: number | null; version: number | null;
  status: 'verified' | 'null' | 'membership_unavailable' | 'unsupported_payload';
  error: string | null; memberSlots: number | null; invalidSlots: number | null;
  members: { proTxHash: string; valid: boolean }[];
};

// One writer per server process, including manually constructed collectors.
// Operators must run this opt-in collector in one process per database.
const collectorFlight = createSingleFlight<void>();

export class PoseChainService {
  private readonly flight = collectorFlight;
  private readonly task = new PeriodicTask({
    intervalMs: config.poseChain.intervalMs, startupDelayMs: 15000,
    run: () => this.collectOnce(),
    onError: () => logger.warn('PoSe chain collector failed; attribution is unavailable until rechecked'),
  });
  constructor(private readonly rpc: RpcReader = rpcService) {}

  async start(): Promise<void> { if (config.poseChain.enabled) await this.task.start(); }
  async stop(): Promise<void> { this.task.stop(); await this.flight.run(async () => {}); }

  async collectOnce(): Promise<void> {
    return this.flight.run(async () => {
      await Promise.all([PoseChainState.init(), PoseChainBlock.init()]);
      await PoseChainState.findOneAndUpdate({ key: 'main' }, { $setOnInsert: {
        key: 'main', startHeight: config.poseChain.startHeight, lastHeight: config.poseChain.startHeight - 1,
      } }, { upsert: true, new: true }).lean();
      const state = await PoseChainState.findOneAndUpdate({ key: 'main' }, {
        $set: { status: 'collecting', error: null }, $inc: { revision: 1 },
      }, { new: true }).lean();
      if (!state) throw new Error('Missing PoSe chain state');
      const stateFilter = { key: 'main', revision: state.revision };
      try {
        if (state.startHeight !== config.poseChain.startHeight) throw new Error('PoSe start height differs from stored checkpoint');
        if (state.lastHeight < state.startHeight - 1 || (state.lastHeight >= state.startHeight) !== Boolean(state.lastHash)) {
          throw new Error('Invalid PoSe checkpoint');
        }
        const chain = z.object({ chain: z.literal('main'), blocks: z.number().int().nonnegative() })
          .parse(await this.rpc.call('getblockchaininfo'));
        z.object({ version: z.literal(230000), subversion: z.literal('/DeFCoN:23.0.0/') })
          .parse(await this.rpc.call('getnetworkinfo'));
        const targetHeight = Math.max(0, chain.blocks - config.poseChain.confirmations + 1);
        await PoseChainState.updateOne(stateFilter, { $set: { targetHeight } });
        let lastHeight = state.lastHeight; let lastHash = state.lastHash;
        if (lastHeight >= state.startHeight) {
          const checkpointBlock = await PoseChainBlock.findOne({ height: lastHeight, hash: lastHash, canonical: true }).lean();
          // A rollback crash may already have hidden the old checkpoint block.
          // Treat that case as needing the same ancestor search as a reorg.
          const same = Boolean(checkpointBlock) && lastHeight <= chain.blocks && await this.hashAt(lastHeight) === lastHash;
          if (!same) {
            let forkHeight = lastHeight; let forkHash: string | null = null; let found = false;
            for (let depth = 0; depth < config.poseChain.reorgMaxDepth; depth++) {
              forkHeight--;
              if (forkHeight < state.startHeight) { found = true; break; }
              if (forkHeight > chain.blocks) continue;
              const old = await PoseChainBlock.findOne({ height: forkHeight, canonical: true }).lean();
              if (old && old.hash === await this.hashAt(forkHeight)) { forkHash = old.hash; found = true; break; }
            }
            if (!found) throw new Error('PoSe reorg exceeds configured depth; manual review required');
            // Hide the old branch before advancing/replaying the independent checkpoint.
            await PoseChainBlock.updateMany({ height: { $gt: forkHeight }, canonical: true }, { $set: { canonical: false } });
            lastHeight = forkHeight; lastHash = forkHash;
            await PoseChainState.updateOne(stateFilter, { $set: {
              lastHeight, lastHash, lastReorgAt: new Date(), checkedAt: null,
            } });
          }
        }
        // A crash can leave written blocks beyond the checkpoint. Replay them.
        await PoseChainBlock.updateMany({ height: { $gt: lastHeight }, canonical: true }, { $set: { canonical: false } });
        for (let n = 0; n < config.poseChain.blocksPerRun && lastHeight < targetHeight; n++) {
          const height = lastHeight + 1; const hash = await this.hashAt(height);
          const block = blockSchema.parse(await this.rpc.call('getblock', [hash, 2]));
          if (block.hash !== hash || block.height !== height || (lastHash && block.previousblockhash !== lastHash)) {
            throw new Error('PoSe block identity/parent changed while collecting');
          }
          const commitments = await this.readCommitments(block.tx.filter((entry) => entry.type === 6), height, hash);
          if (await this.hashAt(height) !== hash) throw new Error('PoSe block reorganized during RPC collection');
          await PoseChainBlock.updateOne({ hash }, { $set: {
            height, previousHash: block.previousblockhash, time: new Date(block.time * 1000),
            checkedAt: new Date(), membershipCheckedAt: new Date(), canonical: false, commitments,
            transactionTypes: attributionTransactionTypes(block),
            attributionCheckedAt: null,
            penaltyAttribution: emptyPenaltyAttribution(commitments.length ? 'disabled' : 'not_applicable',
              commitments.length ? 'disabled' : 'no_commitments'),
          } }, { upsert: true });
          if (await this.hashAt(height) !== hash) throw new Error('PoSe block reorganized during persistence');
          await PoseChainBlock.updateOne({ hash }, { $set: { canonical: true } });
          const checkpoint = await PoseChainState.updateOne({ ...stateFilter, lastHeight, lastHash }, { $set: {
            lastHeight: height, lastHash: hash, checkedAt: new Date(),
          } });
          if (checkpoint.matchedCount !== 1) throw new Error('Concurrent PoSe checkpoint modification');
          lastHeight = height; lastHash = hash;
        }
        // Retry older missing membership fairly, with a separate bounded RPC budget.
        // Raw payloads remain evidence even when the daemon has pruned quorum info.
        const pending = config.poseChain.membershipRetryBlocks ? await PoseChainBlock.find({ canonical: true,
          height: { $gte: state.startHeight, $lte: Math.min(state.lastHeight, lastHeight, targetHeight) },
          'commitments.status': 'membership_unavailable',
        }).sort({ membershipCheckedAt: 1, height: 1 }).limit(config.poseChain.membershipRetryBlocks).lean() : [];
        for (const block of pending) {
          if (await this.hashAt(block.height) !== block.hash) throw new Error('PoSe retry block reorganized');
          const refreshed = await this.readCommitments(block.commitments
            .filter((entry) => entry.status === 'membership_unavailable')
            .map((entry) => ({ txid: entry.txid, extraPayload: entry.rawPayload })), block.height, block.hash);
          if (await this.hashAt(block.height) !== block.hash) throw new Error('PoSe retry reorganized during RPC');
          await PoseChainBlock.updateOne({ hash: block.hash, canonical: true }, { $set: {
            commitments: block.commitments.map((entry) => refreshed.find((record) => record.txid === entry.txid) ?? entry),
            membershipCheckedAt: new Date(),
          } });
        }
        if (config.poseChain.attributionEnabled) {
          const scorePending = await PoseChainBlock.find({ canonical: true,
            height: { $gte: state.startHeight, $lte: Math.min(lastHeight, targetHeight) },
            'commitments.0': { $exists: true },
            $or: [{ penaltyAttribution: null }, { 'penaltyAttribution.status': { $in: ['disabled', 'state_unavailable'] } }],
          }).sort({ attributionCheckedAt: 1, height: 1 }).limit(config.poseChain.attributionBlocksPerRun).lean();
          for (const block of scorePending) {
            if (await this.hashAt(block.height) !== block.hash) throw new Error('PoSe attribution block reorganized');
            let types = block.transactionTypes;
            if (!types) {
              const verbose = blockSchema.parse(await this.rpc.call('getblock', [block.hash, 2]));
              if (verbose.hash !== block.hash || verbose.height !== block.height || verbose.previousblockhash !== block.previousHash
                || verbose.tx.filter((tx) => tx.type === 6).map((tx) => tx.txid).join(',')
                  !== block.commitments.map((c) => c.txid).join(',')) throw new Error('PoSe attribution block identity changed');
              types = attributionTransactionTypes(verbose);
            }
            const attribution = await this.readPenaltyAttribution(block.height, block.hash, block.previousHash, types, block.commitments);
            if (await this.hashAt(block.height) !== block.hash) throw new Error('PoSe attribution reorganized during state RPC');
            await PoseChainBlock.updateOne({ hash: block.hash, canonical: true }, { $set: {
              transactionTypes: types, penaltyAttribution: attribution, attributionCheckedAt: new Date(),
            } });
          }
        }
        // Recheck the checkpoint even if no new block was eligible.
        if (lastHash && await this.hashAt(lastHeight) !== lastHash) throw new Error('PoSe checkpoint reorganized before publication');
        const published = await PoseChainState.updateOne(stateFilter, { $set: { status: 'ready', checkedAt: new Date(), error: null } });
        if (published.matchedCount !== 1) throw new Error('Concurrent PoSe publication');
      } catch (error) {
        // Keep API failure text generic: never publish daemon credentials or error configs.
        await PoseChainState.updateOne(stateFilter, { $set: { status: 'error', error: 'Chain collection or validation failed' } });
        throw error;
      }
    });
  }

  private async readPenaltyAttribution(height: number, hash: string, previousHash: string,
    types: number[] | null, commitments: AttributionCommitment[]) {
    const gap = penaltyContextGap(types, commitments);
    if (gap) return gap;
    try {
      const genesis = await this.hashAt(0);
      const before = parsePenaltySnapshot(await this.rpc.call('protx', ['listdiff', genesis, previousHash]), height - 1);
      const after = parsePenaltySnapshot(await this.rpc.call('protx', ['listdiff', genesis, hash]), height);
      return replayPenaltyAttribution(height, types!, commitments, before, after);
    } catch {
      return emptyPenaltyAttribution('state_unavailable', 'state_unavailable');
    }
  }

  private async readCommitments(transactions: { txid: string; extraPayload?: string }[], height: number, hash: string) {
    const commitments: StoredCommitment[] = [];
    for (const tx of transactions) {
      const rawPayload = tx.extraPayload;
      if (!rawPayload || rawPayload.length > 16384) throw new Error('Missing/oversized commitment payload');
      const record: StoredCommitment = {
        txid: tx.txid, rawPayload, quorumType: null, quorumHash: null, quorumIndex: null,
        version: null, status: 'unsupported_payload', error: null, memberSlots: null, invalidSlots: null, members: [],
      };
      let decoded;
      try { decoded = decodeCommitment(rawPayload); }
      catch { record.error = 'Payload decoder does not support or validate this commitment'; }
      if (decoded) {
        if (decoded.height !== height) throw new Error('Commitment payload height disagrees with block');
        Object.assign(record, { quorumType: decoded.quorumType, quorumHash: decoded.quorumHash,
          quorumIndex: decoded.quorumIndex, version: decoded.version, memberSlots: decoded.validMembers.length,
          invalidSlots: decoded.validMembers.filter((valid) => !valid).length,
        });
        if (decoded.isNull) record.status = 'null';
        else {
          try {
            record.members = verifiedCommitmentMembers(decoded, hash,
              await this.rpc.call('quorum', ['info', decoded.quorumType, decoded.quorumHash, false]));
            record.status = 'verified';
          } catch {
            record.status = 'membership_unavailable';
            record.error = 'Quorum membership unavailable or inconsistent with mined payload';
          }
        }
      }
      commitments.push(record);
    }
    return commitments;
  }

  private async hashAt(height: number): Promise<string> {
    return chainHashSchema.parse(await this.rpc.call('getblockhash', [height]));
  }
}
export const poseChainService = new PoseChainService();
