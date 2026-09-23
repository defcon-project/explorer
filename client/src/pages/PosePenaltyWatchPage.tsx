import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  HiOutlineExclamationTriangle,
  HiOutlineServerStack,
  HiOutlineSignal,
} from 'react-icons/hi2';
import { fetchMasternodeHealth } from '../services/api';
import { formatNumber, truncateHash } from '../utils/formatters';
import { usePageVisibility } from '../hooks/usePageVisibility';
import './PageStyles.css';
import './PosePenaltyWatchPage.css';

function versionLabel(walletVersion?: string | null, protocolVersion?: number | null): string {
  if (walletVersion) return walletVersion;
  if (typeof protocolVersion === 'number') return `protocol ${protocolVersion}`;
  return '-';
}

function serviceLabel(ip?: string | null, port?: number | null, service?: string | null): string {
  if (ip) return port ? `${ip}:${port}` : ip;
  return service || '-';
}

export default function PosePenaltyWatchPage() {
  const isPageVisible = usePageVisibility();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['devtools', 'pose-penalty-watch'],
    queryFn: () => fetchMasternodeHealth(24, 'hour', 10),
    refetchInterval: isPageVisible ? 60_000 : false,
    staleTime: 30_000,
  });

  const rows = data?.poseWatchlist ?? [];
  const maxPenalty = useMemo(
    () => rows.reduce((max, row) => Math.max(max, row.posePenalty), 0),
    [rows],
  );
  const connectedRows = rows.filter((row) => typeof row.peerCount === 'number' && row.peerCount > 0).length;
  const knownVersions = new Set(
    rows
      .map((row) => versionLabel(row.walletVersion, row.protocolVersion))
      .filter((version) => version !== '-'),
  ).size;

  return (
    <div className="fade-in ppw-shell">
      <section className="ppw-hero">
        <div>
          <span className="ppw-kicker">
            <HiOutlineExclamationTriangle />
            Dev Tools
          </span>
          <h1 className="page-title">
            <HiOutlineSignal />
            PoSe Penalty Watch
          </h1>
          <p className="page-subtitle">
            Current masternodes with active PoSe penalty points that are not banned yet. This view is for
            catching weak or misconfigured nodes before they fall into POSE_BANNED.
          </p>
        </div>
        <button className="button" type="button" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <section className="ppw-stats">
        <div className="ppw-stat">
          <span>Penalty nodes</span>
          <strong>{isLoading ? '...' : formatNumber(rows.length)}</strong>
        </div>
        <div className="ppw-stat">
          <span>Highest penalty</span>
          <strong>{isLoading ? '...' : formatNumber(maxPenalty)}</strong>
        </div>
        <div className="ppw-stat">
          <span>Connected peers</span>
          <strong>{isLoading ? '...' : formatNumber(connectedRows)}</strong>
        </div>
        <div className="ppw-stat">
          <span>Known versions</span>
          <strong>{isLoading ? '...' : formatNumber(knownVersions)}</strong>
        </div>
      </section>

      <section className="card ppw-card">
        <div className="card-header">
          <h2 className="card-title">
            <HiOutlineServerStack />
            Nodes receiving penalty points
          </h2>
          <span className="badge badge-accent">
            {isLoading ? 'Loading...' : `${formatNumber(rows.length)} active penalty`}
          </span>
        </div>

        {error ? (
          <div className="ppw-empty">
            Failed to load penalty watchlist: {(error as Error).message}
          </div>
        ) : isLoading ? (
          <div className="ppw-empty">Loading current penalty nodes...</div>
        ) : rows.length === 0 ? (
          <div className="ppw-empty">No live masternodes are currently receiving PoSe penalty points.</div>
        ) : (
          <div className="ppw-table-wrap">
            <table className="ppw-table">
              <thead>
                <tr>
                  <th>IP / Service</th>
                  <th>Wallet version</th>
                  <th>Penalty</th>
                  <th>Status</th>
                  <th>Country</th>
                  <th>Peers</th>
                  <th>ProTx</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const service = serviceLabel(row.ip, row.port, row.service);
                  return (
                    <tr key={row.nodeId}>
                      <td>
                        <div className="ppw-primary mono" title={service}>{service}</div>
                        {row.ip && <div className="ppw-muted mono">{row.ip}</div>}
                      </td>
                      <td className="mono">{versionLabel(row.walletVersion, row.protocolVersion)}</td>
                      <td>
                        <span className="ppw-penalty">{formatNumber(row.posePenalty)}</span>
                      </td>
                      <td>
                        <span className="badge warning">{row.status}</span>
                      </td>
                      <td>
                        <span className="mono">{row.countryCode || '-'}</span>
                        <div className="ppw-muted">{row.countryName || 'Unknown'}</div>
                      </td>
                      <td className="mono">
                        {typeof row.peerCount === 'number' ? formatNumber(row.peerCount) : '-'}
                      </td>
                      <td className="mono" title={row.proTxHash || row.nodeId}>
                        {truncateHash(row.proTxHash || row.nodeId, 6)}
                      </td>
                      <td>
                        {row.payoutAddress ? (
                          <Link className="ppw-link mono" to={`/address/${row.payoutAddress}`}>
                            {truncateHash(row.payoutAddress, 6)}
                          </Link>
                        ) : (
                          <span className="ppw-muted">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
