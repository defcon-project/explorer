import { getHeaderStatus } from '../../client/src/utils/headerStatus';
import type { StatsView, SyncStatusView } from '../../client/src/types/api';

const now = 1_790_967_600_000;
const sync: SyncStatusView = {
  isRunning: false, lastSyncedHeight: 145705, daemonHeight: 145705,
  rpcConnected: true, blocksRemaining: 0, progress: 100, error: null,
};
const fresh = { blockHeight: 145705, lastBlockTime: now / 1000 - 60, avgBlockTime: 151.82 } as StatsView;
const stale = { ...fresh, lastBlockTime: now / 1000 - 15 * 60 } as StatsView;

describe('header chain status', () => {
  it('is live when the indexed chain is current and realtime is connected', () => {
    expect(getHeaderStatus(fresh, sync, now, now, true)).toMatchObject({ label: 'Live', healthy: true });
  });
  it('keeps polling healthy when the websocket is disconnected', () => {
    expect(getHeaderStatus(fresh, sync, now, now, false)).toMatchObject({ label: 'Polling', healthy: true });
  });
  it('reports a long block gap as delayed even when the index is caught up', () => {
    const status = getHeaderStatus(stale, sync, now, now, true);
    expect(status).toMatchObject({ label: 'Delayed', healthy: false });
    expect(status.title).toMatch(/Latest indexed block is .* old/);
  });
  it('shows actual indexing lag before chain freshness', () => {
    expect(getHeaderStatus(fresh, { ...sync, lastSyncedHeight: 145700, blocksRemaining: 5 }, now, now, true))
      .toMatchObject({ label: 'Syncing', healthy: false });
  });
  it('treats the normal one-block indexing transition as current', () => {
    expect(getHeaderStatus(fresh, { ...sync, lastSyncedHeight: 145704, blocksRemaining: 1 }, now, now, true).label)
      .toBe('Live');
  });
  it('prioritizes an RPC failure over zero remaining blocks', () => {
    expect(getHeaderStatus(fresh, { ...sync, rpcConnected: false }, now, now, true))
      .toMatchObject({ label: 'Disconnected', healthy: false });
    expect(getHeaderStatus(fresh, { ...sync, errorCode: 'RPC_UNAVAILABLE' }, now, now, true).label).toBe('Disconnected');
  });
  it('reports indexing errors separately', () => {
    expect(getHeaderStatus(fresh, { ...sync, error: 'Sync failed' }, now, now, true).label).toBe('Sync error');
  });
  it('ignores an old sync status and falls back to chain freshness', () => {
    expect(getHeaderStatus(fresh, { ...sync, rpcConnected: false }, now - 120_001, now, true).label).toBe('Live');
    expect(getHeaderStatus(stale, { ...sync, rpcConnected: false }, now - 120_001, now, true).label).toBe('Delayed');
  });
  it('falls back to chain freshness without a sync status', () => {
    expect(getHeaderStatus(fresh, undefined, 0, now, true).label).toBe('Live');
    expect(getHeaderStatus(stale, undefined, 0, now, true).label).toBe('Delayed');
    expect(getHeaderStatus(undefined, undefined, 0, now, true).label).toBe('Checking');
  });
  it('treats a missing last-block timestamp as delayed', () => {
    expect(getHeaderStatus({ ...fresh, lastBlockTime: undefined } as unknown as StatsView, sync, now, now, true).label)
      .toBe('Delayed');
  });
});
