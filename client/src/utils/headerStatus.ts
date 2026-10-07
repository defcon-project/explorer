import type { StatsView, SyncStatusView } from '../types/api';

const CHAIN_STALE_MIN_SECONDS = 10 * 60;
// Sync status older than this is ignored, so a failed refresh never pins an old state.
const SYNC_STATUS_MAX_AGE_MS = 120_000;

export interface HeaderStatus {
  label: string;
  title: string;
  healthy: boolean;
}

export function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return 'under a minute';
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function getHeaderStatus(
  stats: StatsView | undefined,
  sync: SyncStatusView | undefined,
  syncUpdatedAt: number,
  nowMs: number,
  realtimeConnected: boolean,
): HeaderStatus {
  // A fresh sync status can name a concrete cause. Without one, the header falls back
  // to the freshness of the indexed chain.
  if (sync && nowMs - syncUpdatedAt <= SYNC_STATUS_MAX_AGE_MS) {
    if (sync.rpcConnected === false || sync.errorCode === 'RPC_UNAVAILABLE') {
      return { label: 'Disconnected', title: 'Explorer cannot reach the node', healthy: false };
    }
    if (sync.error) {
      return { label: 'Sync error', title: 'Explorer indexing reported an error', healthy: false };
    }
    if (sync.daemonHeight >= 0 && sync.lastSyncedHeight >= 0) {
      const remaining = Math.max(sync.blocksRemaining, sync.daemonHeight - sync.lastSyncedHeight, 0);
      // One block behind is the ordinary transition while a new block is being indexed.
      if (remaining > 1) {
        return { label: 'Syncing', title: `Indexing ${remaining} remaining blocks`, healthy: false };
      }
    }
  }

  if (!stats) return { label: 'Checking', title: 'Waiting for indexed chain status', healthy: false };

  const chainAgeSeconds =
    typeof stats.lastBlockTime === 'number'
      ? Math.max(0, Math.floor(nowMs / 1000) - stats.lastBlockTime)
      : null;
  const staleAfterSeconds = Math.max(CHAIN_STALE_MIN_SECONDS, (stats.avgBlockTime ?? 150) * 4);
  if (chainAgeSeconds == null || chainAgeSeconds > staleAfterSeconds) {
    return {
      label: 'Delayed',
      title: chainAgeSeconds == null
        ? 'The indexed chain has no last-block timestamp'
        : `Latest indexed block is ${formatAge(chainAgeSeconds)} old (freshness threshold: ${formatAge(staleAfterSeconds)})`,
      healthy: false,
    };
  }

  return realtimeConnected
    ? { label: 'Live', title: 'Realtime connection is active and the indexed chain is current', healthy: true }
    : { label: 'Polling', title: 'Indexed chain is current; realtime connection is reconnecting', healthy: true };
}
