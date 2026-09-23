import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  HiOutlineWallet,
  HiOutlineArrowDownTray,
  HiOutlineArrowUpTray,
  HiOutlineDocumentText,
} from 'react-icons/hi2';
import { fetchAddress, fetchAddressTxs } from '../services/api';
import { formatNumber, formatCoin, truncateHash, formatAge } from '../utils/formatters';
import './PageStyles.css';

interface TxVin {
  address?: string;
  value?: number;
}

interface TxVout {
  value?: number;
  scriptPubKey?: {
    addresses?: string[];
  };
}

interface AddressTx {
  txid: string;
  blockheight: number;
  blocktime: number;
  totalValueOut: number;
  isDonation?: boolean;
  vin?: TxVin[];
  vout?: TxVout[];
}

export default function AddressPage() {
  const { address } = useParams();
  const [page, setPage] = useState(1);

  const { data: addr, isLoading: loading, error } = useQuery({
    queryKey: ['address', address],
    queryFn: () => fetchAddress(address || ''),
    enabled: !!address,
  });
  const { data: txsData } = useQuery({
    queryKey: ['address-txs', address, page],
    queryFn: () => fetchAddressTxs(address || '', page),
    enabled: !!address,
  });
  const txs = (txsData?.data || []) as AddressTx[];
  const pagination = txsData?.pagination || { page: 1, pages: 1 };
  const currentAddress = addr?.address || address || '';

  if (loading) {
    return (
      <div className="fade-in">
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading address...</div>
      </div>
    );
  }

  if (error || !addr) {
    return (
      <div className="fade-in">
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <h2>Address Not Found</h2>
          <p className="text-muted">Address not found. It may not have any transactions yet.</p>
          <Link to="/richlist" className="btn btn-secondary" style={{ marginTop: '1rem' }}>Rich List</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title"><HiOutlineWallet /> Address Details</h1>
        <p className="page-subtitle mono" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>
          {addr.address}
        </p>
      </div>

      <div className="grid-stats" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <div className="stat-label"><HiOutlineWallet /> Balance</div>
          <div className="stat-value">{formatCoin(addr.balance)}</div>
          <div className="stat-change">DFCN</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><HiOutlineArrowDownTray /> Total Received</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{formatCoin(addr.totalReceived)}</div>
          <div className="stat-change">DFCN</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><HiOutlineArrowUpTray /> Total Sent</div>
          <div className="stat-value" style={{ color: 'var(--error)' }}>{formatCoin(addr.totalSent)}</div>
          <div className="stat-change">DFCN</div>
        </div>
        <div className="stat-card">
          <div className="stat-label"><HiOutlineDocumentText /> Transactions</div>
          <div className="stat-value">{formatNumber(addr.txCount)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><HiOutlineDocumentText /> Transaction History</h2>
        </div>
        {txs.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No transactions found</div>
        ) : (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>TX Hash</th>
                    <th>Block</th>
                    <th>Age</th>
                    <th>Net Value</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((tx) => {
                    const isSent = tx.vin?.some((v) => v.address === currentAddress);
                    const isReceived = tx.vout?.some((v) =>
                      v.scriptPubKey?.addresses?.includes(currentAddress)
                    );

                    const sentValue =
                      tx.vin?.reduce((sum, v) => {
                        if (v.address !== currentAddress) return sum;
                        return sum + Number(v.value || 0);
                      }, 0) || 0;
                    const receivedValue =
                      tx.vout?.reduce((sum, v) => {
                        if (!v.scriptPubKey?.addresses?.includes(currentAddress)) return sum;
                        return sum + Number(v.value || 0);
                      }, 0) || 0;
                    const netValue = receivedValue - sentValue;
                    const netColor =
                      netValue > 0 ? 'var(--success)' : netValue < 0 ? 'var(--error)' : 'var(--text-secondary)';
                    const netPrefix = netValue > 0 ? '+' : netValue < 0 ? '-' : '';
                    const netFormatted = formatCoin(Math.abs(netValue));
                    const isSelfTransfer = isSent && isReceived;

                    const txType = isSelfTransfer
                      ? netValue > 0
                        ? '⚡ Stake Reward'
                        : 'Self'
                      : isSent
                        ? 'Sent'
                        : 'Received';
                    const typeClass =
                      txType === 'Sent'
                        ? 'error'
                        : txType === 'Self'
                          ? 'warning'
                          : 'success';

                    return (
                      <tr key={tx.txid}>
                        <td>
                          <Link to={`/searchv2?q=${encodeURIComponent(tx.txid)}`} className="hash mono">
                            {truncateHash(tx.txid, 12)}
                          </Link>
                          {tx.isDonation && (
                            <span className="badge donate" style={{ marginLeft: '0.45rem' }}>
                              ❤ Donate
                            </span>
                          )}
                        </td>
                        <td>
                          <Link to={`/searchv2?q=${encodeURIComponent(String(tx.blockheight))}`} className="hash">
                            #{formatNumber(tx.blockheight)}
                          </Link>
                        </td>
                        <td className="text-muted">{formatAge(tx.blocktime)}</td>
                        <td className="mono" style={{ color: netColor }}>
                          {netPrefix}
                          {netFormatted} DFCN
                        </td>
                        <td>
                          <span className={`badge ${typeClass}`}>{txType}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage(page - 1)} disabled={page <= 1}>&lsaquo;</button>
                <span style={{ padding: '0.5rem 1rem', color: 'var(--text-secondary)' }}>
                  Page {page} of {pagination.pages}
                </span>
                <button onClick={() => setPage(page + 1)} disabled={page >= pagination.pages}>&rsaquo;</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
