import { getHeaderStatus } from '../../client/src/utils/headerStatus';
import type { StatsView, SyncStatusView } from '../../client/src/types/api';

const now = 1_790_967_600_000;
const sync: SyncStatusView = {
  isRunning: false, lastSyncedHeight: 145705, daemonHeight: 145705,
  rpcConnected: true, blocksRemaining: 0, progress: 100, error: null,
};
const stats = { blockHeight: 145704, lastBlockTime: now / 1000 - 900, avgBlockTime: 151.82 } as StatsView;

describe('header chain status', () => {
  it('treats a long block gap and cached stats as healthy when the index is caught up', () => {
    expect(getHeaderStatus(stats, sync, now, now, true)).toMatchObject({ label: 'Waiting', healthy: true });
  });
  it('does not turn a browser clock offset into an indexing warning', () => {
    expect(getHeaderStatus(stats, sync, now + 3600000, now + 3600000, true).healthy).toBe(true);
  });
  it('shows actual indexing lag even with a recent block timestamp', () => {
    expect(getHeaderStatus({ ...stats, lastBlockTime: now / 1000 }, {
      ...sync, lastSyncedHeight: 145700, blocksRemaining: 5,
    }, now, now, true)).toMatchObject({ label: 'Syncing', healthy: false });
  });
  it('keeps the normal one-block indexing transition healthy', () => {
    expect(getHeaderStatus(stats, { ...sync, lastSyncedHeight: 145704, blocksRemaining: 1 }, now, now, true))
      .toMatchObject({ label: 'Syncing', healthy: true });
  });
  it('prioritizes an RPC failure over zero remaining blocks', () => {
    expect(getHeaderStatus(stats, { ...sync, rpcConnected: false }, now, now, true))
      .toMatchObject({ label: 'Disconnected', healthy: false });
  });
  it('reports indexing errors separately', () => {
    expect(getHeaderStatus(stats, { ...sync, error: 'Sync failed' }, now, now, true).label).toBe('Sync error');
  });
  it('allows a short refresh failure but expires retained status', () => {
    expect(getHeaderStatus(stats, sync, now - 30000, now, true).healthy).toBe(true);
    expect(getHeaderStatus(stats, sync, now - 120001, now, true))
      .toMatchObject({ label: 'Unavailable', healthy: false });
  });
  it('does not claim health without confirmed RPC status', () => {
    expect(getHeaderStatus(stats, undefined, 0, now, true).label).toBe('Checking');
    expect(getHeaderStatus(stats, { ...sync, rpcConnected: undefined }, now, now, true).label).toBe('Checking');
  });
  it('keeps polling healthy when the websocket is disconnected', () => {
    expect(getHeaderStatus({ ...stats, lastBlockTime: now / 1000 }, sync, now, now, false))
      .toMatchObject({ label: 'Polling', healthy: true });
  });
});
