import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  HiOutlineArrowPath,
  HiOutlineExclamationTriangle,
  HiOutlineServerStack,
  HiOutlineSignal,
} from 'react-icons/hi2';
import { fetchNodeInventory } from '../services/api';
import { formatNumber, truncateHash } from '../utils/formatters';
import { usePageVisibility } from '../hooks/usePageVisibility';
import type { NodeInventoryChainStatus } from '../types/api';
import './PageStyles.css';
import './NodeInventoryPage.css';

const CHAIN_LABELS: Record<NodeInventoryChainStatus, string> = {
  main_chain: 'Explorer reference match',
  ahead: 'Ahead',
  behind: 'Behind',
  hash_mismatch: 'Hash mismatch',
  unknown: 'Not comparable',
};

function timeAgo(value: string | null): string {
  if (!value) return '-';
  const ageMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return '-';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function chainBadge(status: NodeInventoryChainStatus, delta: number | null) {
  const suffix = typeof delta === 'number' && delta !== 0 ? ` ${delta > 0 ? '+' : ''}${delta}` : '';
  return <span className={`ni-chain ni-chain-${status}`}>{CHAIN_LABELS[status]}{suffix}</span>;
}

export default function NodeInventoryPage() {
  const isPageVisible = usePageVisibility();
  const [versionFilter, setVersionFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [chainFilter, setChainFilter] = useState<'all' | NodeInventoryChainStatus>('all');
  const [legacyOnly, setLegacyOnly] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['devtools', 'node-inventory'],
    queryFn: fetchNodeInventory,
    staleTime: 45_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });

  const sources = useMemo(
    () => Array.from(new Set((data?.nodes ?? []).flatMap((node) => node.sources))).sort(),
    [data?.nodes],
  );
  const rows = useMemo(() => (data?.nodes ?? []).filter((node) => {
    if (versionFilter !== 'all' && (node.walletVersion || 'Unknown') !== versionFilter) return false;
    if (sourceFilter !== 'all' && !node.sources.includes(sourceFilter)) return false;
    if (chainFilter !== 'all' && node.chainStatus !== chainFilter) return false;
    if (legacyOnly && !node.isDeprecated) return false;
    return true;
  }), [chainFilter, data?.nodes, legacyOnly, sourceFilter, versionFilter]);

  return (
    <div className="fade-in ni-shell">
      <section className="ni-hero">
        <div>
          <span className="ni-kicker"><HiOutlineSignal /> Dev Tools</span>
          <h1 className="page-title"><HiOutlineServerStack /> Node Version &amp; Chain Inventory</h1>
          <p className="page-subtitle">
            Stored observations from seed nodes, the DNS seeder, direct peers, test nodes, and the masternode RPC snapshot.
          </p>
        </div>
        <button className="button" type="button" onClick={() => refetch()} disabled={isFetching}>
          <HiOutlineArrowPath className={isFetching ? 'spin' : undefined} /> {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section className="ni-stats">
        <Stat label="Observed nodes" value={data?.summary.observed} />
        <Stat label={`Recommended v${data?.requiredVersion ?? ''}`} value={data?.summary.recommended} tone="success" />
        <Stat label="Legacy versions" value={data?.summary.deprecated} tone="warning" />
        <Stat label="Chain drift / mismatch" value={data?.summary.chainRisk} tone="danger" />
      </section>

      <section className="card ni-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Version inventory</h2>
            <p className="ni-description">
              Current node state is stored separately from change events. A version or chain-state transition is recorded once, not on every poll.
            </p>
          </div>
          <span className="badge badge-accent">
            {data ? `${formatNumber(data.summary.knownVersion)} known versions` : 'Loading...'}
          </span>
        </div>

        <div className="ni-filter-grid">
          <label>
            <span>Wallet version</span>
            <select value={versionFilter} onChange={(event) => setVersionFilter(event.target.value)}>
              <option value="all">All versions</option>
              {(data?.versions ?? []).map((entry) => (
                <option key={entry.version} value={entry.version}>{entry.version} ({entry.count})</option>
              ))}
            </select>
          </label>
          <label>
            <span>Source</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All sources</option>
              {sources.map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
          </label>
          <label>
            <span>Chain status</span>
            <select value={chainFilter} onChange={(event) => setChainFilter(event.target.value as 'all' | NodeInventoryChainStatus)}>
              <option value="all">All states</option>
              {Object.entries(CHAIN_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="ni-legacy-toggle">
            <input type="checkbox" checked={legacyOnly} onChange={(event) => setLegacyOnly(event.target.checked)} />
            <span>Legacy only (&lt; v{data?.requiredVersion ?? '...'})</span>
          </label>
        </div>

        {error ? (
          <div className="ni-empty"><HiOutlineExclamationTriangle /> Failed to load inventory: {(error as Error).message}</div>
        ) : isLoading ? (
          <div className="ni-empty">Loading stored node observations...</div>
        ) : rows.length === 0 ? (
          <div className="ni-empty">No nodes match the selected filters.</div>
        ) : (
          <div className="ni-table-wrap">
            <table className="ni-table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Sources</th>
                  <th>Wallet version</th>
                  <th>Chain</th>
                  <th>Height</th>
                  <th>Hash</th>
                  <th>MN status</th>
                  <th>Last observed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((node) => (
                  <tr key={node.nodeKey}>
                    <td>
                      <div className="ni-ip mono" title={`${node.ip}:${node.port}`}>{node.ip}</div>
                      <div className="ni-muted">{node.labels.join(', ') || `port ${node.port}`}</div>
                    </td>
                    <td><div className="ni-source-list">{node.sources.map((source) => <span className="badge" key={source}>{source}</span>)}</div></td>
                    <td>
                      <span className={node.isDeprecated ? 'ni-version ni-version-legacy' : 'ni-version'}>
                        {node.walletVersion || (node.protocolVersion != null ? `protocol ${node.protocolVersion}` : 'Unknown')}
                      </span>
                      {node.isDeprecated && <div className="ni-muted">legacy</div>}
                    </td>
                    <td>{chainBadge(node.chainStatus, node.blocksDelta)}</td>
                    <td className="mono">{node.blockHeight != null ? formatNumber(node.blockHeight) : '-'}</td>
                    <td className="mono ni-hash" title={node.bestBlockHash || undefined}>{node.bestBlockHash ? truncateHash(node.bestBlockHash, 6) : '-'}</td>
                    <td>
                      {node.masternodeStatus ? <span className="badge">{node.masternodeStatus}</span> : <span className="ni-muted">-</span>}
                    </td>
                    <td>
                      <span className={node.isStale ? 'ni-stale' : 'ni-observed'} title={node.lastObservedAt}>{timeAgo(node.lastObservedAt)}</span>
                      {node.lastSeenAt && <div className="ni-muted">seen {timeAgo(node.lastSeenAt)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className={`ni-stat${tone ? ` ni-stat-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value == null ? '...' : formatNumber(value)}</strong>
    </div>
  );
}
