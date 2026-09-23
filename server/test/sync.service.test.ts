import { realtimeService } from '../src/services/realtime.service';
import { syncService } from '../src/services/sync.service';

type SyncServiceInternals = {
  publishSyncStatus: (
    state: 'idle' | 'syncing' | 'complete' | 'error',
    daemonHeight: number,
    lastSyncedHeight: number,
    opts?: { message?: string; error?: string | null }
  ) => void;
  publishBlockEvents: (
    block: { hash: string; height: number; time: number; txids: string[]; minedBy?: string },
    emitTxEvents: boolean
  ) => void;
  prevoutCacheKey: (txid: string, voutIndex: number) => string;
};

describe('sync service internals', () => {
  const service = syncService as unknown as SyncServiceInternals;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('publishes normalized sync status payload', () => {
    const publishSpy = jest
      .spyOn(realtimeService, 'publishSyncStatus')
      .mockImplementation(() => undefined);

    service.publishSyncStatus('idle', 10, 7, { message: 'up to date' });
    service.publishSyncStatus('error', -5, -1, { error: 'rpc unavailable' });

    expect(publishSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        state: 'idle',
        daemonHeight: 10,
        lastSyncedHeight: 7,
        blocksRemaining: 3,
        message: 'up to date',
        error: null,
      })
    );
    expect((publishSpy.mock.calls[0][0] as { progress: number }).progress).toBeCloseTo(72.73, 2);

    expect(publishSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        state: 'error',
        daemonHeight: -1,
        lastSyncedHeight: -1,
        blocksRemaining: 0,
        error: 'rpc unavailable',
      })
    );
  });

  it('publishes block event and caps tx events per block', () => {
    const blockSpy = jest.spyOn(realtimeService, 'publishNewBlock').mockImplementation(() => undefined);
    const txSpy = jest.spyOn(realtimeService, 'publishNewTx').mockImplementation(() => undefined);

    const txids = Array.from({ length: 300 }, (_, index) => `tx-${index}`);
    service.publishBlockEvents(
      {
        hash: 'h'.repeat(64),
        height: 42,
        time: 1700000000,
        txids,
        minedBy: 'miner',
      },
      true
    );

    expect(blockSpy).toHaveBeenCalledWith({
      hash: 'h'.repeat(64),
      height: 42,
      time: 1700000000,
      txCount: 300,
      minedBy: 'miner',
    });
    expect(txSpy).toHaveBeenCalledTimes(250);
    expect(txSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ txid: 'tx-0', index: 0, blockHeight: 42 })
    );
    expect(txSpy).toHaveBeenNthCalledWith(
      250,
      expect.objectContaining({ txid: 'tx-249', index: 249, blockHeight: 42 })
    );

    txSpy.mockClear();
    service.publishBlockEvents(
      {
        hash: 'z'.repeat(64),
        height: 43,
        time: 1700000100,
        txids: ['a', 'b'],
      },
      false
    );
    expect(txSpy).not.toHaveBeenCalled();
  });

  it('builds deterministic prevout cache keys', () => {
    expect(service.prevoutCacheKey('txid', 2)).toBe('txid:2');
  });
});
