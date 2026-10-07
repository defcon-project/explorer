import type { StatsView, SyncStatusView } from '../types/api';

export function getHeaderStatus(
  stats: StatsView | undefined,
  sync: SyncStatusView | undefined,
  syncUpdatedAt: number,
  nowMs: number,
  realtimeConnected: boolean,
) {
  if (!sync) return { label: 'Checking', title: 'Waiting for sync status', healthy: false };
  // A failed refresh can retain previous data. Do not present it as current forever.
  if (nowMs - syncUpdatedAt > 120_000) {
    return { label: 'Unavailable', title: 'Sync status has not refreshed for over two minutes', healthy: false };
  }
  if (sync.rpcConnected === false || sync.errorCode === 'RPC_UNAVAILABLE') {
    return { label: 'Disconnected', title: 'Explorer cannot reach the node', healthy: false };
  }
  if (sync.error) return { label: 'Sync error', title: 'Explorer indexing reported an error', healthy: false };
  if (sync.rpcConnected !== true || sync.daemonHeight < 0 || sync.lastSyncedHeight < 0) {
    return { label: 'Checking', title: 'Waiting for a confirmed node and index height', healthy: false };
  }
  const remaining = Math.max(sync.blocksRemaining, sync.daemonHeight - sync.lastSyncedHeight, 0);
  if (remaining > 0) {
    return {
      label: 'Syncing',
      title: `Indexing ${remaining} remaining block${remaining === 1 ? '' : 's'}`,
      // One block is an ordinary transition when a new block arrives.
      healthy: remaining <= 1,
    };
  }
  const age = stats?.lastBlockTime == null ? null : Math.max(0, nowMs / 1000 - stats.lastBlockTime);
  const threshold = Math.max(600, (stats?.avgBlockTime ?? 150) * 4);
  if (age != null && age > threshold) {
    return {
      label: 'Waiting',
      title: 'Explorer is caught up with the node; waiting for the next block',
      healthy: true,
    };
  }
  return realtimeConnected
    ? { label: 'Live', title: 'Explorer is caught up; realtime connection is active', healthy: true }
    : { label: 'Polling', title: 'Explorer is caught up; checking for updates by polling', healthy: true };
}
