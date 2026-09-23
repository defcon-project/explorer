import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HiOutlineArrowPath, HiOutlineSignal } from 'react-icons/hi2';
import { fetchDnsSeederNodes, fetchPreReleaseNodes, fetchSeedNodes } from '../services/api';
import type { DnsSeederNodeView, PreReleaseNodeView, SeedChainStatus, SeedNodeStatus } from '../types/api';
import { usePageVisibility } from '../hooks/usePageVisibility';
import './PageStyles.css';

function formatAge(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function shortHash(hash: string | null | undefined): string {
  const value = String(hash || '').trim();
  if (!value) return '-';
  return `${value.slice(0, 4)}**`;
}

function shortSeedAlias(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '');
}

interface ChainReference {
  height: number;
  hash: string;
}

interface ChainComparison {
  status: SeedChainStatus;
  delta?: number;
}

const BLOCK_HASH_PATTERN = /^[0-9a-f]{64}$/i;

function normalizeBlockHash(value: string | null | undefined): string | null {
  const hash = String(value || '').trim();
  return BLOCK_HASH_PATTERN.test(hash) ? hash : null;
}

function seedChainBadge(status: SeedChainStatus, blocksDelta?: number): React.ReactNode {
  const map: Record<SeedChainStatus, { label: string; className: string }> = {
    'seed-baseline': { label: 'SEED CONSENSUS', className: 'badge success' },
    'matches-seed': { label: 'MATCHES SEED', className: 'badge success' },
    'seed-divergence': { label: 'SEED DIVERGENCE', className: 'badge error' },
    'hash-mismatch': { label: 'HASH MISMATCH', className: 'badge error' },
    behind: { label: 'BEHIND', className: 'badge warning' },
    ahead: { label: 'AHEAD', className: 'badge badge-accent' },
    'height-match': { label: 'HEIGHT MATCH ONLY', className: 'badge' },
    'not-comparable': { label: 'NOT COMPARABLE', className: 'badge' },
  };
  const state = map[status] ?? map['not-comparable'];

  let deltaLabel = '';
  if (typeof blocksDelta === 'number' && blocksDelta !== 0) {
    deltaLabel = blocksDelta > 0 ? ` +${blocksDelta}` : ` ${blocksDelta}`;
  }

  return (
    <span className={state.className}>
      {state.label}
      {deltaLabel ? <span style={{ fontWeight: 400, opacity: 0.85 }}>{deltaLabel}</span> : null}
    </span>
  );
}

function seedObservedAt(seed: SeedNodeStatus): number {
  const sourceTimestamp = seed.updatedAt ? Date.parse(seed.updatedAt) : NaN;
  return Number.isFinite(sourceTimestamp) ? sourceTimestamp : seed.fetchedAt;
}

function isStaleTimestamp(timestamp: number, maxAgeMs: number): boolean {
  return !Number.isFinite(timestamp) || Date.now() - timestamp > maxAgeMs;
}

function seedAvailabilityBadge(seed: SeedNodeStatus): React.ReactNode {
  if (!seed.reachable || seed.daemonRunning === false) return <span className="badge error">OFFLINE</span>;

  const status = String(seed.status || '').trim().toLowerCase();
  if (status.includes('sync')) return <span className="badge warning">SYNCING</span>;
  if (isStaleTimestamp(seedObservedAt(seed), 180_000)) return <span className="badge warning">STALE</span>;
  return <span className="badge success">ONLINE</span>;
}

function directNodeAvailabilityBadge(status: string | null | undefined, checkedAt: string | null | undefined): React.ReactNode {
  const value = String(status || '').trim().toLowerCase();
  const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
  const stale = isStaleTimestamp(checkedMs, 180_000);
  if (value.includes('offline') || value.includes('down') || value.includes('disconnected')) {
    return <span className="badge error">OFFLINE</span>;
  }
  if (stale) return <span className="badge warning">STALE</span>;
  if (value.includes('sync')) return <span className="badge warning">SYNCING</span>;
  return <span className="badge success">ONLINE</span>;
}

function snapshotAvailabilityBadge(lastSeen: string | null | undefined): React.ReactNode {
  const seenMs = lastSeen ? Date.parse(lastSeen) : NaN;
  const stale = isStaleTimestamp(seenMs, 15 * 60_000);
  return <span className={`badge ${stale ? 'warning' : ''}`}>{stale ? 'STALE SNAPSHOT' : 'SNAPSHOT'}</span>;
}

function dnsSeederAvailabilityBadge(node: DnsSeederNodeView): React.ReactNode {
  if (node.isLivePeer) return <span className="badge success">LIVE PEER</span>;
  return snapshotAvailabilityBadge(node.lastSeen);
}

function getSeedReference(seedRows: SeedNodeStatus[] | undefined): ChainReference | null {
  if (!Array.isArray(seedRows) || seedRows.length === 0) return null;

  const baselineRows = seedRows.filter(
    (row) =>
      row.chainStatus === 'seed-baseline' &&
      typeof row.blockHeight === 'number' &&
      Number.isFinite(row.blockHeight) &&
      Boolean(normalizeBlockHash(row.bestBlockHash))
  );
  if (baselineRows.length < 2) return null;

  const { blockHeight, bestBlockHash } = baselineRows[0];
  const referenceHash = normalizeBlockHash(bestBlockHash);
  if (!referenceHash || baselineRows.some((row) => row.blockHeight !== blockHeight || normalizeBlockHash(row.bestBlockHash) !== referenceHash)) {
    return null;
  }
  return { height: blockHeight!, hash: referenceHash };
}

function deriveChainComparison(
  blockHeight: number | null,
  bestBlockHash: string | null | undefined,
  reference: ChainReference | null
): ChainComparison {
  if (typeof blockHeight !== 'number' || !Number.isFinite(blockHeight)) {
    return { status: 'not-comparable' };
  }
  if (!reference) {
    return { status: 'not-comparable' };
  }

  const delta = blockHeight - reference.height;
  const hash = normalizeBlockHash(bestBlockHash);
  if (delta === 0 && hash === reference.hash) return { status: 'matches-seed' };
  if (delta === 0 && hash && hash !== reference.hash) return { status: 'hash-mismatch', delta };
  if (delta === 0) return { status: 'height-match', delta };
  if (delta < 0) return { status: 'behind', delta };
  return { status: 'ahead', delta };
}

export default function NetworkHealthPage() {
  const isPageVisible = usePageVisibility();

  const {
    data: seedData,
    isLoading: seedLoading,
    error: seedError,
    dataUpdatedAt: seedUpdatedAt,
  } = useQuery<SeedNodeStatus[]>({
    queryKey: ['seed-nodes'],
    queryFn: fetchSeedNodes,
    staleTime: 75_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });

  const {
    data: preReleaseData,
    isLoading: preReleaseLoading,
    error: preReleaseError,
    dataUpdatedAt: preReleaseUpdatedAt,
  } = useQuery<PreReleaseNodeView[]>({
    queryKey: ['network-pre-release-nodes'],
    queryFn: fetchPreReleaseNodes,
    staleTime: 75_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });

  const {
    data: dnsSeederData,
    isLoading: dnsSeederLoading,
    error: dnsSeederError,
    dataUpdatedAt: dnsSeederUpdatedAt,
  } = useQuery<DnsSeederNodeView[]>({
    queryKey: ['network-dns-seeder-nodes'],
    queryFn: fetchDnsSeederNodes,
    staleTime: 55_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });

  const preReleaseRows = useMemo(() => {
    if (!preReleaseData) return [];
    return preReleaseData
      .slice()
      .sort((a, b) => {
        if (Boolean(a.isCanonicalFallbackSeed) !== Boolean(b.isCanonicalFallbackSeed)) {
          return a.isCanonicalFallbackSeed ? -1 : 1;
        }
        const aHeight = typeof a.blockHeight === 'number' ? a.blockHeight : -1;
        const bHeight = typeof b.blockHeight === 'number' ? b.blockHeight : -1;
        return bHeight - aHeight;
      })
      .slice(0, 50);
  }, [preReleaseData]);

  const dnsSeederRows = useMemo(() => {
    if (!dnsSeederData) return [];
    return dnsSeederData
      .slice()
      .sort((a, b) => {
        if (Boolean(a.isLivePeer) !== Boolean(b.isLivePeer)) {
          return a.isLivePeer ? -1 : 1;
        }
        const aHeight = typeof a.blockHeight === 'number' ? a.blockHeight : a.snapshotBlockHeight ?? -1;
        const bHeight = typeof b.blockHeight === 'number' ? b.blockHeight : b.snapshotBlockHeight ?? -1;
        return bHeight - aHeight;
      })
      .slice(0, 25);
  }, [dnsSeederData]);

  const seedReference = useMemo(() => getSeedReference(seedData), [seedData]);

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">
          <HiOutlineSignal />
          Nodes
        </h1>
        <p className="page-subtitle">Hardcoded seed baseline, monitored test nodes, and hash-verified DNS snapshots</p>
      </div>

      <>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header">
              <div>
                <h2 className="card-title">Seed Nodes</h2>
                <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                  {seedReference
                    ? `Seed baseline confirmed: ${seedReference.height.toLocaleString()} / ${shortHash(seedReference.hash)}`
                    : 'Seed baseline unavailable: the seeds disagree on the block hash, or their tips are too far apart.'}
                </p>
              </div>
            </div>

            {seedLoading ? (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">Loading seed node status...</p>
              </div>
            ) : seedError ? (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">Failed to load seed node status.</p>
              </div>
            ) : seedData && seedData.length > 0 ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <colgroup>
                      <col style={{ width: '24%' }} />
                      <col style={{ width: '11%' }} />
                      <col style={{ width: '15%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '10%' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Node</th>
                      <th>Availability</th>
                        <th>Chain status</th>
                        <th>Height</th>
                        <th>Hash</th>
                        <th>Connections</th>
                        <th>Version</th>
                        <th>Checked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seedData.map((seed) => (
                        <tr key={seed.ip}>
                          <td>
                            <code style={{ fontWeight: 600 }}>{seed.ip}</code>
                            <br />
                            <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                              {shortSeedAlias(seed.label)}
                            </span>
                          </td>
                          <td>{seedAvailabilityBadge(seed)}</td>
                          <td>{seedChainBadge(seed.chainStatus, seed.blocksDelta)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {seed.blockHeight != null ? seed.blockHeight.toLocaleString() : '-'}
                          </td>
                          <td>
                            <code style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                              {shortHash(seed.bestBlockHash)}
                            </code>
                          </td>
                          <td>{seed.connections ?? '-'}</td>
                          <td>
                            <code style={{ fontSize: '0.72rem' }}>
                              {seed.version ? seed.version.replace(/^\/DeFCoN:|\/$/g, '') : '-'}
                            </code>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                            {formatAge(seedObservedAt(seed))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {seedData.some((seed) => seed.warnings) ? (
                  <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border-soft)' }}>
                    {seedData
                      .filter((seed) => seed.warnings)
                      .map((seed) => (
                        <div key={seed.ip} className="text-muted" style={{ fontSize: '0.8rem' }}>
                          {seed.label}: {seed.warnings}
                        </div>
                      ))}
                  </div>
                ) : null}

                {seedData.some((seed) => !seed.reachable && seed.error) ? (
                  <div style={{ padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border-soft)' }}>
                    {seedData
                      .filter((seed) => !seed.reachable && seed.error)
                      .map((seed) => (
                        <div key={seed.ip} className="text-muted" style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
                          {seed.label} ({seed.ip}): {seed.error}
                        </div>
                      ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">No seed node data available.</p>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header">
              <div>
                <h2 className="card-title">Test Nodes</h2>
                <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                  Core static fallback seeds are marked and shown first.
                </p>
              </div>
              <span className="badge badge-accent">3 fallback seeds</span>
            </div>
            {preReleaseLoading ? (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">Loading test node snapshot...</p>
              </div>
            ) : preReleaseError ? (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">Failed to load test node snapshot.</p>
              </div>
            ) : preReleaseRows.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <colgroup>
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Node</th>
                        <th>Availability</th>
                      <th>Chain status</th>
                      <th>Height</th>
                      <th>Hash</th>
                      <th>Connections</th>
                      <th>Version</th>
                      <th>Checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preReleaseRows.map((node) => {
                      const derivedChain = deriveChainComparison(node.blockHeight, node.bestBlockHash, seedReference);
                      const checkedMs = node.checkedAt ? Date.parse(node.checkedAt) : NaN;
                      const checkedLabel = Number.isFinite(checkedMs) ? formatAge(checkedMs) : '-';
                      const versionLabel =
                        node.walletVersion ||
                        (typeof node.protocolVersion === 'number' ? `protocol ${node.protocolVersion}` : '-');
                      return (
                        <tr key={`${node.ip}:${node.port}`}>
                          <td>
                            <code>{node.ip}</code>
                            {node.nodeLabel ? (
                              <>
                                <br />
                                <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                                  {node.nodeLabel.toLowerCase()}
                                </span>
                              </>
                            ) : null}
                            {node.isCanonicalFallbackSeed ? (
                              <>
                                <br />
                                <span className="badge badge-accent" style={{ marginTop: '0.3rem' }}>
                                  Core fallback seed
                                </span>
                              </>
                            ) : null}
                          </td>
                          <td>{directNodeAvailabilityBadge(node.status, node.checkedAt)}</td>
                          <td>{seedChainBadge(derivedChain.status, derivedChain.delta)}</td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {typeof node.blockHeight === 'number' ? node.blockHeight.toLocaleString() : '-'}
                          </td>
                          <td>
                            <code style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                              {shortHash(node.bestBlockHash)}
                            </code>
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {typeof node.peerCount === 'number' ? node.peerCount.toLocaleString() : '-'}
                          </td>
                          <td>
                            <code style={{ fontSize: '0.72rem' }}>{versionLabel}</code>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                            {checkedLabel}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">No test node data available.</p>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="card-header">
              <div>
                <h2 className="card-title">DNS-Seeder</h2>
                <p className="text-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem' }}>
                  Direct peers are live-verified. Other rows are discovery snapshots and are never used to infer chain health.
                </p>
              </div>
              <span className="badge badge-accent">
                {dnsSeederRows.filter((node) => node.isLivePeer).length} live peer{dnsSeederRows.filter((node) => node.isLivePeer).length === 1 ? '' : 's'}
              </span>
            </div>
            {dnsSeederLoading ? (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">Loading DNS seeder snapshot...</p>
              </div>
            ) : dnsSeederError ? (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">Failed to load DNS seeder snapshot.</p>
              </div>
            ) : dnsSeederRows.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <colgroup>
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '10%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Node</th>
                      <th>Source</th>
                      <th>Chain status</th>
                      <th>Height</th>
                      <th>Hash</th>
                      <th>Connections</th>
                      <th>Version</th>
                      <th>Checked</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dnsSeederRows.map((node) => {
                      const observedAt = node.isLivePeer ? node.livePeerObservedAt : node.lastSeen;
                      const observedMs = observedAt ? Date.parse(observedAt) : NaN;
                      const checkedLabel = Number.isFinite(observedMs) ? formatAge(observedMs) : '-';
                      const walletVersionLabel = node.walletVersion
                        ? node.walletVersion
                        : typeof node.protocolVersion === 'number'
                          ? `protocol ${node.protocolVersion}`
                          : '-';
                      const chain = node.isLivePeer
                        ? deriveChainComparison(node.blockHeight, node.bestBlockHash, seedReference)
                        : { status: 'not-comparable' as const };
                      const displayedHeight = node.isLivePeer ? node.blockHeight : node.snapshotBlockHeight;
                      return (
                        <tr key={`${node.ip}:${node.port}`}>
                          <td>
                            <code>{node.ip}</code>
                          </td>
                          <td>{dnsSeederAvailabilityBadge(node)}</td>
                          <td>
                            {node.isLivePeer ? (
                              seedChainBadge(chain.status, chain.delta)
                            ) : (
                              <span className="badge">UNVERIFIED SNAPSHOT</span>
                            )}
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {typeof displayedHeight === 'number' ? displayedHeight.toLocaleString() : '-'}
                          </td>
                          <td>
                            <code style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                              {shortHash(node.bestBlockHash)}
                            </code>
                          </td>
                          <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {typeof node.peerCount === 'number' ? node.peerCount.toLocaleString() : '-'}
                          </td>
                          <td>
                            <code style={{ fontSize: '0.72rem' }}>{walletVersionLabel}</code>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                            {checkedLabel}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="placeholder-content" style={{ padding: '1.25rem' }}>
                <p className="text-muted">No DNS seeder records are available.</p>
              </div>
            )}
          </div>
      </>

      {Math.max(seedUpdatedAt, preReleaseUpdatedAt, dnsSeederUpdatedAt) > 0 && (
        <p className="text-muted" style={{ fontSize: '0.75rem', textAlign: 'right' }}>
          <HiOutlineArrowPath style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Last updated:{' '}
          {new Date(Math.max(seedUpdatedAt, preReleaseUpdatedAt, dnsSeederUpdatedAt)).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
