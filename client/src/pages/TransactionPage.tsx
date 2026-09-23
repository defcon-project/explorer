import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  HiOutlineBanknotes,
  HiOutlineClock,
  HiOutlineArrowRight,
  HiOutlineCube,
} from 'react-icons/hi2';
import { fetchTransaction } from '../services/api';
import { formatNumber, truncateHash, formatAge, formatDate, formatBytes, formatCoin } from '../utils/formatters';
import './PageStyles.css';

export default function TransactionPage() {
  const { txid } = useParams();

  const { data: tx, isLoading: loading, error } = useQuery({
    queryKey: ['tx', txid],
    queryFn: () => fetchTransaction(txid || ''),
    enabled: !!txid,
  });

  if (loading) {
    return (
      <div className="fade-in">
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading transaction...</div>
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="fade-in">
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <h2>Transaction Not Found</h2>
          <p className="text-muted">Transaction not found. It may not be synced yet.</p>
          <Link to="/blocks" className="btn btn-secondary" style={{ marginTop: '1rem' }}>Browse Blocks</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title"><HiOutlineBanknotes /> Transaction Details</h1>
        <p className="page-subtitle mono" style={{ fontSize: '0.8rem' }}>{tx.txid}</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><HiOutlineBanknotes /> Summary</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            {tx.isDonation && <span className="badge donate">❤ Donate</span>}
            <span className="badge success">{tx.confirmations} Confirmations</span>
          </div>
        </div>
        <div className="detail-grid">
          <div className="detail-row">
            <div className="detail-label">TX Hash</div>
            <div className="detail-value" style={{ fontSize: '0.8rem' }}>{tx.txid}</div>
          </div>
          <div className="detail-row">
            <div className="detail-label"><HiOutlineCube /> Block</div>
            <div className="detail-value">
              <Link to={`/searchv2?q=${encodeURIComponent(String(tx.blockheight))}`} className="hash">
                #{formatNumber(tx.blockheight)}
              </Link>
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-label"><HiOutlineClock /> Time</div>
            <div className="detail-value">{formatDate(tx.blocktime)} ({formatAge(tx.blocktime)})</div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Size</div>
            <div className="detail-value">{formatBytes(tx.size)}</div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Total Input</div>
            <div className="detail-value value-highlight">{formatCoin(tx.totalValueIn)} DFCN</div>
          </div>
          <div className="detail-row">
            <div className="detail-label">Total Output</div>
            <div className="detail-value value-highlight">{formatCoin(tx.totalValueOut)} DFCN</div>
          </div>
          {tx.isDonation && (tx.donationAmount || 0) > 0 && (
            <div className="detail-row">
              <div className="detail-label">Donation Amount</div>
              <div className="detail-value value-highlight">❤ {formatCoin(tx.donationAmount || 0)} DFCN</div>
            </div>
          )}
          <div className="detail-row">
            <div className="detail-label">Fee</div>
            <div className="detail-value">{formatCoin(tx.fee)} DFCN</div>
          </div>
          {tx.isCoinbase && (
            <div className="detail-row">
              <div className="detail-label">Type</div>
              <div className="detail-value"><span className="badge">Block Reward (Coinbase)</span></div>
            </div>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: '1.5rem' }}>
        {/* Inputs */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Inputs ({tx.vin.length})</h2>
          </div>
          {tx.vin.map((vin, i: number) => (
            <div key={i} className="latest-item" style={{ textDecoration: 'none', cursor: 'default' }}>
              <div className="latest-item-icon tx-icon">
                <HiOutlineArrowRight />
              </div>
              <div className="latest-item-info">
                <div className="latest-item-primary">
                  {vin.address ? (
                    <Link to={`/searchv2?q=${encodeURIComponent(vin.address)}`} className="hash mono">
                      {truncateHash(vin.address, 10)}
                    </Link>
                  ) : (
                    <span className="badge">Coinbase Input</span>
                  )}
                </div>
              </div>
              <div className="latest-item-value">
                <span className="latest-amount">
                  {typeof vin.value === 'number' ? `${formatCoin(vin.value)} DFCN` : 'N/A'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Outputs */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Outputs ({tx.vout.length})</h2>
          </div>
          {tx.vout.map((vout, i: number) => (
            <div key={i} className="latest-item" style={{ textDecoration: 'none', cursor: 'default' }}>
              <div className="latest-item-icon block-icon">
                <HiOutlineArrowRight />
              </div>
              <div className="latest-item-info">
                <div className="latest-item-primary">
                  {vout.scriptPubKey.addresses?.[0] ? (
                    <Link to={`/searchv2?q=${encodeURIComponent(vout.scriptPubKey.addresses[0])}`} className="hash mono">
                      {truncateHash(vout.scriptPubKey.addresses[0], 10)}
                    </Link>
                  ) : (
                    <span className="text-muted">{vout.scriptPubKey.type}</span>
                  )}
                </div>
              </div>
              <div className="latest-item-value">
                <span className="latest-reward">
                  {typeof vout.value === 'number' ? `${formatCoin(vout.value)} DFCN` : '-'}
                </span>
                <span className="latest-size">{vout.scriptPubKey.type}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

