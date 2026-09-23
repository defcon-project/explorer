import { memo, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchStats } from '../../services/api';
import { useAutoRefresh } from '../../context/AutoRefreshContext';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { formatNumber } from '../../utils/formatters';
import type { DashboardOverviewView, StatsView } from '../../types/api';

interface HeaderStatusChipsProps {
  compact?: boolean;
}

const CHAIN_STALE_MIN_SECONDS = 10 * 60;
const STATUS_CLOCK_INTERVAL_MS = 60_000;

function formatMetric(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return formatNumber(value);
}

function formatAge(ageSeconds: number): string {
  if (ageSeconds < 60) return 'under a minute';
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function HeaderStatusChips({ compact = false }: HeaderStatusChipsProps) {
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisibility();
  const { realtimeConnected } = useAutoRefresh();

  const cachedDashboardStats = queryClient.getQueryData<DashboardOverviewView | undefined>([
    'dashboard-overview',
  ])?.stats;

  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    initialData: cachedDashboardStats as StatsView | undefined,
    staleTime: 60_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isPageVisible) return;
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), STATUS_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isPageVisible]);

  const stats = statsQuery.data;
  const height = formatMetric(stats?.blockHeight);
  const peers = formatMetric(stats?.connections);
  const masternodes = formatMetric(stats?.masternodes);
  const stakers = formatMetric(stats?.stakingWallets);
  const chainAgeSeconds =
    typeof stats?.lastBlockTime === 'number'
      ? Math.max(0, Math.floor(nowMs / 1000) - stats.lastBlockTime)
      : null;
  const staleAfterSeconds = Math.max(CHAIN_STALE_MIN_SECONDS, (stats?.avgBlockTime ?? 150) * 4);
  const chainFresh = chainAgeSeconds != null && chainAgeSeconds <= staleAfterSeconds;
  const status = !stats
    ? { label: 'Checking', title: 'Waiting for indexed chain status' }
    : !chainFresh
      ? {
          label: 'Delayed',
          title: chainAgeSeconds == null
            ? 'The indexed chain has no last-block timestamp'
            : `Latest indexed block is ${formatAge(chainAgeSeconds)} old (freshness threshold: ${formatAge(staleAfterSeconds)})`,
        }
      : realtimeConnected
        ? { label: 'Live', title: 'Realtime connection is active and the indexed chain is current' }
        : { label: 'Polling', title: 'Indexed chain is current; realtime connection is reconnecting' };
  const isLive = status.label === 'Live';

  return (
    <div className={`header-status-chips ${compact ? 'compact' : ''}`} aria-label="Network status">
      <div
        className={`status-chip status-chip-live ${isLive ? 'online' : 'degraded'}`}
        title={status.title}
      >
        <span className="status-dot" aria-hidden="true" />
        <span className="status-chip-label">{status.label}</span>
      </div>

      <div className="status-chip status-chip-height" title="Current indexed block height">
        <span className="status-chip-label">Height</span>
        <strong className="status-chip-value">{height}</strong>
      </div>

      <div className="status-chip status-chip-peers">
        <span className="status-chip-label">Peers</span>
        <strong className="status-chip-value">{peers}</strong>
      </div>

      <div className="status-chip status-chip-masternodes">
        <span className="status-chip-label">MN</span>
        <strong className="status-chip-value">{masternodes}</strong>
      </div>

      <div className="status-chip status-chip-stakers" title="Active staking wallets in the last 24 hours">
        <span className="status-chip-label">Stakers</span>
        <strong className="status-chip-value">{stakers}</strong>
      </div>
    </div>
  );
}

export default memo(HeaderStatusChips);

