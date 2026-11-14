import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HiOutlineArrowRight, HiStar } from 'react-icons/hi2';
import { fetchMasternodes } from '../../services/api';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { formatNumber, truncateHash } from '../../utils/formatters';
import { masternodePath } from '../../utils/routes';
import { statusName, statusTone } from '../../pages/masternodes/nodeEvents';
import StatePanel from '../ui/StatePanel';
import TimeText from '../ui/TimeText';
import { BAND_MAX_ITEMS, starredNodes, statusCounts, type StarredNode } from './myMasternodesModel';
import './MyMasternodesBand.css';

const MY_NODES_PATH = '/masternodes?mine=1';

function statusLabel(node: StarredNode): string {
  if (node.state === 'missing') return 'Not in the list';
  if (node.state === 'unknown') return 'Status unknown';
  return statusName(node.status);
}

function StatusBadge({ node }: { node: StarredNode }) {
  if (node.state === 'missing') {
    return (
      <span className="badge" title="The current masternode list has no registration with this proTxHash: removed, or registered again under a new one.">
        Not in the list
      </span>
    );
  }
  if (node.state === 'unknown') return <span className="badge">Status unknown</span>;
  return <span className={`badge ${statusTone(node.status)}`.trim()}>{statusName(node.status)}</span>;
}

interface MyMasternodesBandProps {
  /** The visitor's starred proTxHashes (lower case); the page shows the band only when there is one. */
  favorites: readonly string[];
  /** False when the browser storage cannot be used, so the stars last only until a reload. */
  persistent: boolean;
}

/**
 * "My masternodes" on the home page: the visitor's starred masternodes with their status in the current
 * masternode list, the ones that need a look first. It reads the same list as the Masternodes table
 * (one request, shared with that page) and only exists while something is starred.
 */
export default function MyMasternodesBand({ favorites, persistent }: MyMasternodesBandProps) {
  const isPageVisible = usePageVisibility();
  // Same query key and freshness as the Masternodes page, so the two pages share one copy of the list.
  const snapshotQuery = useQuery({
    queryKey: ['masternodes', 'snapshot'],
    queryFn: fetchMasternodes,
    staleTime: 60_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });
  const listNodes = Array.isArray(snapshotQuery.data?.nodes) ? snapshotQuery.data.nodes : null;
  const nodes = useMemo(() => starredNodes(favorites, listNodes), [favorites, listNodes]);
  const shown = nodes.slice(0, BAND_MAX_ITEMS);
  const hidden = nodes.length - shown.length;
  const counts = listNodes ? statusCounts(nodes, statusLabel) : [];
  const observedAt = listNodes ? snapshotQuery.data?.observedAt : undefined;

  let body;
  if (snapshotQuery.isPending) {
    body = <StatePanel className="my-mn-state" title="Loading the status of your starred masternodes..." />;
  } else {
    body = (
      <>
        {!listNodes && (
          <StatePanel
            className="my-mn-state"
            tone="warning"
            title="Status unavailable right now"
            description="The masternode list could not be loaded, so the status of your starred masternodes is unknown."
          />
        )}
        {listNodes && snapshotQuery.isError && (
          <StatePanel
            className="my-mn-state"
            tone="warning"
            title="Status may be out of date"
            description="The masternode list could not be refreshed; the status below is from the last list that loaded."
          />
        )}
        <ul className="my-mn-list" aria-label="Starred masternodes">
          {shown.map((node) => (
            <li key={node.proTxHash}>
              <Link to={masternodePath(node.proTxHash)} className="my-mn-item" title={node.proTxHash}>
                <span className="my-mn-service mono">
                  {node.state === 'listed' ? node.service : truncateHash(node.proTxHash, 6)}
                </span>
                <StatusBadge node={node} />
              </Link>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <Link to={MY_NODES_PATH} className="my-mn-more">
            {formatNumber(hidden)} more in My nodes <HiOutlineArrowRight aria-hidden="true" />
          </Link>
        )}
      </>
    );
  }

  return (
    <section className="card my-mn-band" aria-labelledby="my-mn-title">
      <div className="card-header my-mn-header">
        <div className="my-mn-heading">
          <h2 className="card-title" id="my-mn-title">
            <HiStar aria-hidden="true" /> My masternodes
          </h2>
          {counts.length > 0 && (
            <p className="my-mn-summary">
              {counts.map(({ label, count }, index) => (
                <span key={label}>
                  {index > 0 && ' · '}
                  <span className="my-mn-count">{`${formatNumber(count)} ${label}`}</span>
                </span>
              ))}
            </p>
          )}
        </div>
        <Link to={MY_NODES_PATH} className="btn btn-sm btn-secondary">
          Open My nodes <HiOutlineArrowRight aria-hidden="true" />
        </Link>
      </div>
      {body}
      {observedAt && (
        <p className="my-mn-note">
          Status from the masternode list of <TimeText value={observedAt} />.
        </p>
      )}
      {!persistent && (
        <p className="my-mn-note">
          This browser does not allow saving here, so your stars are kept only until the page is reloaded or closed.
        </p>
      )}
    </section>
  );
}
