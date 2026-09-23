import { config } from '../config';
import { logger } from '../utils/logger';
import { rpcService } from './rpc.service';
import { Block } from '../models/Block';
import { Transaction } from '../models/Transaction';
import { SyncState } from '../models/SyncState';

/**
 * Handles chain reorganization detection and rollback.
 * Accepts a callback for rebuilding the address index, keeping
 * the rebuild logic in the sync service where the helpers live.
 */
export class ReorgHandler {
  constructor(private readonly rebuildAddressIndex: () => Promise<void>) {}

  async checkForReorg(lastHeight: number): Promise<number> {
    const ourBlock = await Block.findOne({ height: lastHeight }).lean();
    if (!ourBlock) {
      const indexedTip = await Block.findOne({})
        .sort({ height: -1 })
        .select({ height: 1, hash: 1 })
        .lean<{ height: number; hash: string }>();
      const correctedHeight = indexedTip?.height ?? -1;
      const correctedHash = indexedTip?.hash ?? '';

      if (correctedHeight !== lastHeight) {
        logger.warn(
          `Sync state pointed to missing block at height ${lastHeight}; corrected to indexed tip ${correctedHeight}.`
        );
        await SyncState.findOneAndUpdate(
          { key: 'main' },
          {
            lastSyncedHeight: correctedHeight,
            lastSyncedHash: correctedHash,
            heartbeatAt: new Date(),
            addressRebuildRequired: true,
          },
          { upsert: true }
        );
      }

      return correctedHeight;
    }

    const daemonHash = await rpcService.getBlockHash(lastHeight);

    if (ourBlock.hash === daemonHash) {
      return lastHeight; // No reorg
    }

    logger.warn(`Chain reorg detected at height ${lastHeight}!`);

    // Walk backwards to find fork point, bounded by configured max depth.
    let forkHeight = lastHeight;
    let traversed = 0;
    let forkPointFound = false;
    while (forkHeight > 0 && traversed < config.sync.reorgMaxDepth) {
      forkHeight--;
      traversed++;
      const block = await Block.findOne({ height: forkHeight }).lean();
      if (!block) {
        forkPointFound = true;
        break;
      }

      const hash = await rpcService.getBlockHash(forkHeight);
      if (block.hash === hash) {
        forkPointFound = true;
        break;
      }
    }

    if (!forkPointFound && forkHeight > 0) {
      throw new Error(
        `Reorg depth exceeded configured limit (${config.sync.reorgMaxDepth}). Manual intervention required.`
      );
    }

    logger.warn(`Fork point: height ${forkHeight}. Rolling back...`);
    await this.rollbackToHeight(forkHeight);
    return forkHeight;
  }

  private async rollbackToHeight(height: number): Promise<void> {
    logger.warn(`Rollback to height ${height} started; rebuilding address index after delete.`);
    await SyncState.findOneAndUpdate(
      { key: 'main' },
      {
        addressRebuildRequired: true,
        heartbeatAt: new Date(),
      },
      { upsert: true }
    );

    const [txResult, blockResult] = await Promise.all([
      Transaction.deleteMany({ blockheight: { $gt: height } }),
      Block.deleteMany({ height: { $gt: height } }),
    ]);

    logger.info(
      `Rolled back ${blockResult.deletedCount} blocks, ${txResult.deletedCount} transactions`
    );

    const indexedTip = await Block.findOne({})
      .sort({ height: -1 })
      .select({ height: 1, hash: 1 })
      .lean<{ height: number; hash: string }>();
    const correctedHeight = Math.min(height, indexedTip?.height ?? -1);
    const correctedHash = correctedHeight >= 0 ? (indexedTip?.hash ?? '') : '';

    // Persist corrected height/hash before rebuild so crashes during rebuild
    // still restart from a coherent chain position.
    await SyncState.findOneAndUpdate(
      { key: 'main' },
      {
        lastSyncedHeight: correctedHeight,
        lastSyncedHash: correctedHash,
        addressRebuildRequired: true,
        heartbeatAt: new Date(),
      },
      { upsert: true }
    );

    await this.rebuildAddressIndex();

    await SyncState.findOneAndUpdate(
      { key: 'main' },
      {
        addressRebuildRequired: false,
        heartbeatAt: new Date(),
      },
      { upsert: true }
    );
  }
}
