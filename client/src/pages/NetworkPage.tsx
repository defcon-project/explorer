import { useMemo, useState } from 'react';
import {
  HiOutlineGlobeAlt,
  HiOutlineSignal,
  HiOutlineServerStack,
} from 'react-icons/hi2';
import { useQuery } from '@tanstack/react-query';
import { fetchNetworkInfo, fetchNetworkVersionSample } from '../services/api';
import type { NetworkVersionSampleView, NetworkView } from '../types/api';
import { formatNumber, formatAge } from '../utils/formatters';
import { usePageVisibility } from '../hooks/usePageVisibility';
import './PageStyles.css';
import './NetworkPage.css';

interface VersionDatum {
  name: string;
  value: number;
  color: string;
  sharePct: number;
  identifiedSharePct?: number;
  isDeprecated: boolean;
  isUnknown?: boolean;
}

const versionColors = ['#1f64d8', '#2f8fff', '#58a8ff', '#4f7fd8', '#5cbfff', '#3f6fc6'];
const VERSION_SAMPLE_HOURS = 24;
const OBSERVED_PAGE_SIZE = 50;

type VersionScope = 'inventory' | 'direct';
type PeerSyncState = 'in-sync' | 'minor-lag' | 'behind' | 'ahead' | 'unavailable';

interface PeerSyncAssessment {
  state: PeerSyncState;
  label: string;
  delta: number | null;
}

function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return '??';
  const upper = code.toUpperCase();
  const first = upper.codePointAt(0);
  const second = upper.codePointAt(1);
  if (!first || !second) return '??';
  return String.fromCodePoint(first + 127397, second + 127397);
}

function formatObservedAge(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'N/A';
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function sourceLabel(source: string): string {
  return source.replace(/_/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function getPeerReportedHeight(peer: NetworkView['peers'][number]): number | null {
  const values = [peer.synced_blocks, peer.synced_headers]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

function assessPeerSync(peer: NetworkView['peers'][number], explorerHeight: number | null): PeerSyncAssessment {
  const reportedHeight = getPeerReportedHeight(peer);
  if (explorerHeight == null || reportedHeight == null) {
    return { state: 'unavailable', label: 'No sync data', delta: null };
  }

  const delta = reportedHeight - explorerHeight;
  if (delta === 0) return { state: 'in-sync', label: 'In sync', delta };
  if (delta < 0 && delta >= -2) return { state: 'minor-lag', label: `Behind ${Math.abs(delta)}`, delta };
  if (delta < 0) return { state: 'behind', label: `Behind ${Math.abs(delta)}`, delta };
  return { state: 'ahead', label: `Reports +${delta}`, delta };
}

function parseVersionParts(value: string | undefined): number[] | null {
  const match = value?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isOlderPeerVersion(value: string | undefined, requiredVersion: string | undefined): boolean {
  const candidate = parseVersionParts(value);
  const required = parseVersionParts(requiredVersion);
  if (!candidate || !required) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (candidate[index] !== required[index]) return candidate[index] < required[index];
  }
  return false;
}

export default function NetworkPage() {
  const isPageVisible = usePageVisibility();
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [versionScope, setVersionScope] = useState<VersionScope>('inventory');
  const [observedPage, setObservedPage] = useState(0);
  const networkQuery = useQuery<NetworkView>({
    queryKey: ['network'],
    queryFn: fetchNetworkInfo,
    staleTime: 15_000,
    refetchInterval: isPageVisible ? 30_000 : false,
    refetchOnMount: 'always',
  });
  const network = networkQuery.data;
  const versionSampleQuery = useQuery<NetworkVersionSampleView>({
    queryKey: ['network', 'version-sample', VERSION_SAMPLE_HOURS],
    queryFn: () => fetchNetworkVersionSample(VERSION_SAMPLE_HOURS),
    staleTime: 60_000,
    refetchInterval: isPageVisible ? 120_000 : false,
  });
  const versionSample = versionSampleQuery.data;
  const loading = networkQuery.isLoading;
  const error =
    networkQuery.error != null
      ? ((networkQuery.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ||
          (networkQuery.error as Error)?.message ||
          'Failed to load network info')
      : null;

  const peers = useMemo(() => network?.peers || [], [network?.peers]);

  const versionData = useMemo<VersionDatum[]>(() => {
    if (versionScope === 'inventory') {
      const observed = versionSample?.summary.observed ?? 0;
      const identified = versionSample?.summary.identified ?? 0;
      const unidentified = versionSample?.summary.unidentified ?? 0;
      const coveragePct = versionSample?.summary.coveragePct
        ?? (observed > 0 ? Math.round((identified / observed) * 10_000) / 100 : 0);
      const identifiedVersions: VersionDatum[] = (versionSample?.versions || []).map((entry, index) => ({
        name: entry.version,
        value: entry.count,
        sharePct: entry.observedSharePct
          ?? (observed > 0 ? Math.round((entry.count / observed) * 10_000) / 100 : 0),
        identifiedSharePct: entry.sharePct,
        isDeprecated: entry.isDeprecated,
        color: entry.isDeprecated ? 'var(--danger)' : versionColors[index % versionColors.length],
      }));
      if (unidentified > 0) {
        identifiedVersions.push({
          name: 'Version not reported',
          value: unidentified,
          sharePct: Math.max(0, Math.round((100 - coveragePct) * 100) / 100),
          isDeprecated: false,
          isUnknown: true,
          color: 'var(--text-subtle)',
        });
      }
      return identifiedVersions;
    }

    const versionMap = new Map<string, number>();
    for (const peer of peers) {
      const ver = peer.subver || 'Unknown';
      versionMap.set(ver, (versionMap.get(ver) || 0) + 1);
    }

    return Array.from(versionMap.entries()).map(([name, value], i) => ({
      name,
      value,
      color: versionColors[i % versionColors.length],
      sharePct: peers.length > 0 ? Math.round((value / peers.length) * 10_000) / 100 : 0,
      isDeprecated: false,
    }));
  }, [peers, versionSample, versionScope]);

  const visiblePeers = useMemo(() => {
    if (versionScope !== 'direct' || !selectedVersion) return peers;
    return peers.filter((peer) => (peer.subver || 'Unknown') === selectedVersion);
  }, [peers, selectedVersion, versionScope]);

  const observedNodes = useMemo(() => {
    const nodes = versionSample?.nodes || [];
    return selectedVersion ? nodes.filter((node) => node.walletVersion === selectedVersion) : nodes;
  }, [selectedVersion, versionSample?.nodes]);

  const observedPageCount = Math.max(1, Math.ceil(observedNodes.length / OBSERVED_PAGE_SIZE));
  const safeObservedPage = Math.min(observedPage, observedPageCount - 1);
  const pagedObservedNodes = observedNodes.slice(
    safeObservedPage * OBSERVED_PAGE_SIZE,
    (safeObservedPage + 1) * OBSERVED_PAGE_SIZE,
  );

  const toggleVersionFilter = (version: string) => {
    setSelectedVersion((current) => (current === version ? null : version));
    setObservedPage(0);
  };

  const changeVersionScope = (scope: VersionScope) => {
    setVersionScope(scope);
    setSelectedVersion(null);
    setObservedPage(0);
  };

  const clearPeerFilters = () => {
    setSelectedVersion(null);
  };

  const inbound = peers.filter((p) => p.inbound).length;
  const outbound = peers.filter((p) => !p.inbound).length;
  const ipv6Count = peers.filter((p) => p.isIpv6).length;
  const explorerHeight =
    typeof network?.blockHeight === 'number'
      ? network.blockHeight
      : typeof network?.headerHeight === 'number'
        ? network.headerHeight
        : null;
  const peerSyncSummary = useMemo(() => {
    const counts: Record<PeerSyncState, number> = {
      'in-sync': 0,
      'minor-lag': 0,
      behind: 0,
      ahead: 0,
      unavailable: 0,
    };
    for (const peer of peers) counts[assessPeerSync(peer, explorerHeight).state] += 1;
    return counts;
  }, [explorerHeight, peers]);
  const olderDirectPeers = useMemo(
    () => peers.filter((peer) => isOlderPeerVersion(peer.subver, versionSample?.requiredVersion)).length,
    [peers, versionSample?.requiredVersion],
  );

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title"><HiOutlineGlobeAlt /> Network</h1>
        <p className="page-subtitle">DeFCoN network overview, peers, and geo distribution</p>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="placeholder-content" style={{ padding: '1.5rem' }}>
            <p className="text-muted">{error}</p>
          </div>
        </div>
      )}

      <div className="grid-stats" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-label"><HiOutlineSignal /> Connected Peers</div>
          <div className="stat-value">{loading ? '...' : network?.connections || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><HiOutlineServerStack /> Protocol Version</div>
          <div className="stat-value">{loading ? '...' : network?.protocolversion || 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Inbound</div>
          <div className="stat-value">{loading ? '...' : inbound}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Outbound</div>
          <div className="stat-value">{loading ? '...' : outbound}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">IPv6 Peers</div>
          <div className="stat-value">{loading ? '...' : ipv6Count}</div>
        </div>
      </div>

      {(versionData.length > 0 || peers.length > 0) && (
        <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
          {versionData.length > 0 && (
          <div className="card">
            <div className="card-header network-version-header">
              <div>
                <h2 className="card-title">Node Version Distribution</h2>
                <p className="network-card-subtitle">
                  {versionScope === 'inventory'
                    ? 'Last known daemon version for unique IPs observed across monitored network sources in the last 24 hours.'
                    : 'Current connections reported by the explorer daemon.'}
                </p>
              </div>
              <div className="network-scope-toggle" aria-label="Version sample source">
                <button
                  type="button"
                  className={versionScope === 'inventory' ? 'active' : ''}
                  onClick={() => changeVersionScope('inventory')}
                >
                  Network sample
                </button>
                <button
                  type="button"
                  className={versionScope === 'direct' ? 'active' : ''}
                  onClick={() => changeVersionScope('direct')}
                >
                  Direct peers
                </button>
              </div>
            </div>

            {versionScope === 'inventory' && versionSample && (
              <div className="network-version-summary">
                <span><strong>{formatNumber(versionSample.summary.observed)}</strong> network IPs observed</span>
                <span>
                  <strong>{formatNumber(versionSample.summary.identified)}</strong>
                  version known ({(versionSample.summary.coveragePct
                    ?? (versionSample.summary.observed > 0
                      ? (versionSample.summary.identified / versionSample.summary.observed) * 100
                      : 0)).toFixed(1)}%)
                </span>
                <span className={versionSample.summary.unidentified > 0 ? 'is-warning' : ''}>
                  <strong>{formatNumber(versionSample.summary.unidentified)}</strong> version not reported
                </span>
                <span><strong>{versionSample.windowHours}h</strong> observation window</span>
              </div>
            )}

            {versionScope === 'inventory' && versionSampleQuery.isLoading ? (
              <div className="placeholder-content network-version-placeholder">
                <p className="text-muted">Loading network version sample...</p>
              </div>
            ) : versionScope === 'inventory' && versionSampleQuery.isError ? (
              <div className="placeholder-content network-version-placeholder">
                <p className="text-muted">The network sample is temporarily unavailable. Direct peer data remains available.</p>
              </div>
            ) : versionData.length === 0 ? (
              <div className="placeholder-content" style={{ padding: '2.5rem' }}>
                <p className="text-muted">No version distribution available</p>
              </div>
            ) : (
              <div className="network-version-list">
                {versionData.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    className={`network-version-row ${entry.isUnknown ? 'unknown' : ''} ${selectedVersion === entry.name ? 'active' : ''}`}
                    onClick={() => {
                      if (!entry.isUnknown) toggleVersionFilter(entry.name);
                    }}
                    disabled={entry.isUnknown}
                    title={entry.isUnknown
                      ? 'These IPs were observed, but their source did not expose a wallet version.'
                      : `${entry.identifiedSharePct?.toFixed(1)}% of version-identified nodes; ${entry.sharePct.toFixed(1)}% of all observed IPs.`}
                  >
                    <span className="network-version-row-head">
                      <span className="mono">{entry.name}</span>
                      <span>
                        {entry.isDeprecated && <span className="badge warning">Legacy</span>}
                        <strong>{formatNumber(entry.value)}</strong>
                        <span className="text-muted">{entry.sharePct.toFixed(1)}% observed</span>
                      </span>
                    </span>
                    <span className="network-version-track" aria-hidden="true">
                      <span
                        className={entry.isDeprecated ? 'network-version-fill deprecated' : 'network-version-fill'}
                        style={{ width: `${Math.max(entry.sharePct, 2)}%`, background: entry.color }}
                      />
                    </span>
                  </button>
                ))}
                <div className="network-version-note">
                  <strong className={versionSample && versionSample.summary.deprecated > 0 ? 'is-warning' : ''}>
                    {formatNumber(versionSample?.summary.deprecated ?? 0)} legacy
                  </strong>
                  {' '}among {formatNumber(versionSample?.summary.identified ?? 0)} version-identified nodes.
                  Version timestamps are retained separately because Masternode RPC exposes node identity and state, but not the daemon wallet version.
                </div>
              </div>
            )}
            {selectedVersion && (
              <button type="button" className="btn btn-sm btn-secondary network-clear-filter" onClick={() => toggleVersionFilter(selectedVersion)}>
                Clear version filter
              </button>
            )}
          </div>
          )}

          <div className="card network-sync-card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Peer Sync Health</h2>
                <p className="network-card-subtitle">
                  Direct peers compared with the explorer node at{' '}
                  <strong className="mono">{explorerHeight != null ? formatNumber(explorerHeight) : 'unknown height'}</strong>.
                </p>
              </div>
              <span className="badge badge-accent">{formatNumber(peers.length)} direct peers</span>
            </div>

            <div className="network-sync-summary">
              <div className="network-sync-metric success">
                <strong>{formatNumber(peerSyncSummary['in-sync'])}</strong>
                <span>in sync</span>
              </div>
              <div className="network-sync-metric warning">
                <strong>{formatNumber(peerSyncSummary['minor-lag'] + peerSyncSummary.behind)}</strong>
                <span>behind explorer</span>
              </div>
              <div className="network-sync-metric accent">
                <strong>{formatNumber(peerSyncSummary.ahead)}</strong>
                <span>report ahead</span>
              </div>
              <div className="network-sync-metric muted">
                <strong>{formatNumber(peerSyncSummary.unavailable)}</strong>
                <span>no sync data</span>
              </div>
            </div>

            <div className="network-sync-details">
              <span><strong>{inbound}</strong> inbound / <strong>{outbound}</strong> outbound</span>
              <span className={olderDirectPeers > 0 ? 'is-warning' : ''}>
                <strong>{olderDirectPeers}</strong> older than v{versionSample?.requiredVersion ?? 'current'}
              </span>
            </div>
            <p className="network-sync-disclaimer">
              Height comparison is a sync signal only. It does not establish canonical chain identity during a fork.
            </p>
          </div>
        </div>
      )}

      {versionScope === 'inventory' ? (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title"><HiOutlineServerStack /> Version-identified Nodes (24h)</h2>
              <p className="network-card-subtitle">Last known daemon version per unique IP, with the separate time it was last reported.</p>
            </div>
            <div className="network-table-actions">
              {selectedVersion && <span className="badge badge-accent">Version: {selectedVersion}</span>}
              <span className="badge">{formatNumber(observedNodes.length)} identified nodes</span>
            </div>
          </div>
          {versionSampleQuery.isLoading ? (
            <div className="network-table-placeholder">Loading observed nodes...</div>
          ) : versionSampleQuery.isError ? (
            <div className="network-table-placeholder">Network inventory is temporarily unavailable.</div>
          ) : observedNodes.length === 0 ? (
            <div className="network-table-placeholder">No observed nodes match the selected version.</div>
          ) : (
            <>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Version</th>
                      <th>Height</th>
                      <th>Sources</th>
                      <th>Version reported</th>
                      <th>Last seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedObservedNodes.map((node) => (
                      <tr key={node.ip}>
                        <td className="mono">{node.ip}</td>
                        <td>
                          <span className={`badge ${node.isDeprecated ? 'warning' : 'success'}`}>
                            {node.walletVersion}
                          </span>
                        </td>
                        <td className="mono">
                          {typeof node.blockHeight === 'number' ? formatNumber(node.blockHeight) : 'N/A'}
                        </td>
                        <td>
                          <div className="network-source-list">
                            {node.sources.map((source) => <span className="badge" key={source}>{sourceLabel(source)}</span>)}
                          </div>
                        </td>
                        <td className="text-muted">{formatObservedAge(node.lastVersionObservedAt)}</td>
                        <td className="text-muted">{formatObservedAge(node.lastSeenAt || node.lastObservedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {observedPageCount > 1 && (
                <div className="network-pagination">
                  <span>
                    {safeObservedPage * OBSERVED_PAGE_SIZE + 1}-{Math.min((safeObservedPage + 1) * OBSERVED_PAGE_SIZE, observedNodes.length)} of {formatNumber(observedNodes.length)}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={safeObservedPage === 0}
                      onClick={() => setObservedPage(Math.max(0, safeObservedPage - 1))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      disabled={safeObservedPage >= observedPageCount - 1}
                      onClick={() => setObservedPage(Math.min(observedPageCount - 1, safeObservedPage + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title"><HiOutlineServerStack /> Connected Peers</h2>
            {selectedVersion && (
              <div className="network-table-actions">
                {selectedVersion && <span className="badge badge-accent">Version: {selectedVersion}</span>}
                <span className="badge">{formatNumber(visiblePeers.length)} visible peers</span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={clearPeerFilters}>Show all</button>
              </div>
            )}
          </div>
          {loading ? (
            <div className="network-table-placeholder">Loading peers...</div>
          ) : error && peers.length === 0 ? (
            <div className="network-table-placeholder">{error}</div>
          ) : peers.length === 0 ? (
            <div className="network-table-placeholder">No peer data available</div>
          ) : visiblePeers.length === 0 ? (
            <div className="network-table-placeholder">No peers match the selected filter.</div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Address</th><th>Country</th><th>IP</th><th>Version</th><th>Type</th><th>Height</th><th>Sync</th><th>Connected</th><th>Ping</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePeers.map((peer, i) => (
                    <tr key={`${peer.addr}-${i}`}>
                      {(() => {
                        const sync = assessPeerSync(peer, explorerHeight);
                        const badgeClass = sync.state === 'in-sync'
                          ? 'success'
                          : sync.state === 'minor-lag' || sync.state === 'behind'
                            ? 'warning'
                            : sync.state === 'ahead'
                              ? 'badge-accent'
                              : '';
                        return <>
                      <td className="mono network-peer-address">{peer.addr}</td>
                      <td>
                        <span className="mono network-country-cell">
                          <span aria-hidden>{countryCodeToFlag(peer.countryCode || '')}</span>
                          <span>{peer.countryName || 'Unknown'}</span>
                        </span>
                      </td>
                      <td><span className={`badge ${peer.isIpv6 ? 'warning' : 'success'}`}>{peer.isIpv6 ? 'IPv6' : 'IPv4'}</span></td>
                      <td className="mono network-peer-version">{peer.subver}</td>
                      <td><span className={`badge ${peer.inbound ? '' : 'success'}`}>{peer.inbound ? 'Inbound' : 'Outbound'}</span></td>
                      <td className="mono">{typeof peer.synced_blocks === 'number' ? formatNumber(peer.synced_blocks) : 'N/A'}</td>
                      <td><span className={`badge ${badgeClass}`}>{sync.label}</span></td>
                      <td className="text-muted">{typeof peer.conntime === 'number' ? formatAge(peer.conntime) : 'N/A'}</td>
                      <td className="mono">{typeof peer.pingtime === 'number' ? `${peer.pingtime.toFixed(3)}s` : 'N/A'}</td>
                        </>;
                      })()}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
