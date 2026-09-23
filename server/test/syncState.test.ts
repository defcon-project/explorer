import {
  buildSyncStatusPayload,
  planCatchUp,
  planStartupRecovery,
  shouldPersistSyncCheckpoint,
  syncProgressPercent,
} from '../src/services/sync/syncState';

describe('sync state domain', () => {
  it('computes bounded progress and normalized status payloads', () => {
    expect(syncProgressPercent(-1, -1)).toBe(0);
    expect(syncProgressPercent(-1, 0)).toBe(0);
    expect(syncProgressPercent(0, 0)).toBe(100);
    expect(syncProgressPercent(199, 99)).toBe(100);

    expect(buildSyncStatusPayload('syncing', 10, 7)).toEqual(
      expect.objectContaining({
        state: 'syncing',
        daemonHeight: 10,
        lastSyncedHeight: 7,
        blocksRemaining: 3,
        progress: 72.73,
      })
    );
  });

  it('initializes a missing cursor from the indexed tip', () => {
    expect(planStartupRecovery(null, { height: 42, hash: 'hash-42' })).toEqual({
      initializeCursor: { height: 42, hash: 'hash-42' },
      correctCursor: null,
      resetStaleLock: false,
      rebuildAddressIndex: false,
    });
  });

  it('repairs stale, ahead, and hash-mismatched startup state', () => {
    expect(
      planStartupRecovery(
        {
          lastSyncedHeight: 50,
          lastSyncedHash: 'stale',
          isRunning: true,
          addressRebuildRequired: false,
        },
        { height: 45, hash: 'tip-45' }
      )
    ).toEqual({
      initializeCursor: null,
      correctCursor: { height: 45, hash: 'tip-45' },
      resetStaleLock: true,
      rebuildAddressIndex: true,
    });

    expect(
      planStartupRecovery(
        { lastSyncedHeight: 45, lastSyncedHash: 'wrong-hash' },
        { height: 45, hash: 'tip-45' }
      ).correctCursor
    ).toEqual({ height: 45, hash: 'tip-45' });
  });

  it('plans catch-up work without off-by-one errors', () => {
    expect(planCatchUp(7, 10)).toEqual({
      upToDate: false,
      startHeight: 8,
      endHeight: 10,
      blocksToSync: 3,
    });
    expect(planCatchUp(10, 10)).toEqual({
      upToDate: true,
      startHeight: 11,
      endHeight: 10,
      blocksToSync: 0,
    });
  });

  it('persists checkpoints by block interval, elapsed time, or final block', () => {
    const base = {
      syncStartHeight: 100,
      daemonHeight: 120,
      nowMs: 10_000,
      lastCheckpointAtMs: 9_500,
      blockInterval: 5,
      maxIntervalMs: 2_000,
    };

    expect(shouldPersistSyncCheckpoint({ ...base, currentHeight: 105 })).toBe(true);
    expect(
      shouldPersistSyncCheckpoint({
        ...base,
        currentHeight: 103,
        lastCheckpointAtMs: 7_000,
      })
    ).toBe(true);
    expect(shouldPersistSyncCheckpoint({ ...base, currentHeight: 120 })).toBe(true);
    expect(shouldPersistSyncCheckpoint({ ...base, currentHeight: 103 })).toBe(false);
  });
});
