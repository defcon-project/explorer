import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  HiOutlineArrowDownTray,
  HiOutlineArrowRight,
  HiOutlineArrowUpTray,
  HiOutlineArrowsRightLeft,
  HiOutlineBanknotes,
  HiOutlineClock,
  HiOutlineCube,
  HiOutlineMagnifyingGlass,
  HiOutlineWallet,
} from 'react-icons/hi2';
import { fetchAddress, fetchAddressTxs, fetchSearch, fetchTransaction } from '../services/api';
import type { TxView } from '../types/api';
import { formatAge, formatCoin, formatDate, formatNumber, truncateHash } from '../utils/formatters';
import './PageStyles.css';
import './SearchV2Page.css';

const ADDRESS_TX_PAGE_SIZE = 8;
const FLOW_ENTRY_PREVIEW_LIMIT = 4;
const NET_TOLERANCE = 0.0000001;
const HEX64_RE = /^[a-fA-F0-9]{64}$/;
const BASE58_RE = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

type ApiErrorShape = {
  response?: {
    data?: {
      error?: {
        message?: string;
      };
    };
  };
};

interface FlowEntry {
  key: string;
  amount: number;
  address: string | null;
  href?: string | null;
  label: string;
  isFocus: boolean;
}

interface DirectionSummary {
  label: string;
  tone: 'success' | 'warning' | 'error' | 'neutral';
  sent: number;
  received: number;
  net: number;
}

type RuntimeVin = {
  address?: unknown;
  coinbase?: unknown;
  value?: unknown;
};

type RuntimeVout = {
  value?: unknown;
  scriptPubKey?: {
    addresses?: unknown;
    type?: unknown;
  };
};

function getErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiErrorShape;
  const apiMessage = apiError?.response?.data?.error?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) {
    return apiMessage;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function toAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getVinList(tx: TxView): RuntimeVin[] {
  const vin = (tx as { vin?: unknown }).vin;
  return Array.isArray(vin) ? (vin as RuntimeVin[]) : [];
}

function getVoutList(tx: TxView): RuntimeVout[] {
  const vout = (tx as { vout?: unknown }).vout;
  return Array.isArray(vout) ? (vout as RuntimeVout[]) : [];
}

function getVoutAddresses(vout: RuntimeVout): string[] {
  const addresses = vout?.scriptPubKey?.addresses;
  return Array.isArray(addresses) ? addresses.filter((address): address is string => typeof address === 'string') : [];
}

function getVoutLabel(vout: RuntimeVout, address: string | null): string {
  if (address) return address;
  const type = vout?.scriptPubKey?.type;
  return typeof type === 'string' && type.trim() ? type : 'Unknown output';
}

function isLikelyDfcnAddress(value: string): boolean {
  return (
    value.length >= 26 &&
    value.length <= 35 &&
    value.startsWith('D') &&
    BASE58_RE.test(value)
  );
}

function buildInputEntries(tx: TxView, focusAddress?: string): FlowEntry[] {
  return getVinList(tx).map((vin, index) => {
    const amount = toAmount(vin.value);
    const hasAddress = typeof vin.address === 'string' && vin.address.length > 0;
    const isCoinbase = Boolean(vin.coinbase) || tx.isCoinbase;

    if (hasAddress) {
      const address = vin.address as string;
      return {
        key: `in-${index}-${address}`,
        amount,
        address,
        label: address,
        isFocus: Boolean(focusAddress && focusAddress === address),
      };
    }

    return {
      key: `in-${index}-coinbase`,
      amount,
      address: null,
      label: isCoinbase ? 'Coinbase / Block reward' : 'Unknown input',
      isFocus: false,
    };
  });
}

function buildOutputEntries(tx: TxView, focusAddress?: string): FlowEntry[] {
  return getVoutList(tx).map((vout, index) => {
    const amount = toAmount(vout.value);
    const addresses = getVoutAddresses(vout);
    const address = addresses.length > 0 ? addresses[0] : null;
    const label = getVoutLabel(vout, address);
    const isFocus = Boolean(focusAddress && addresses.includes(focusAddress));

    return {
      key: `out-${index}-${label}`,
      amount,
      address,
      label,
      isFocus,
    };
  });
}

function getDirectionSummary(tx: TxView, focusAddress?: string): DirectionSummary {
  if (!focusAddress) {
    return {
      label: tx.isCoinbase ? 'Block Reward' : 'Transfer',
      tone: tx.isCoinbase ? 'success' : 'neutral',
      sent: 0,
      received: 0,
      net: 0,
    };
  }

  const sent = getVinList(tx).reduce((sum, vin) => {
    if (vin.address !== focusAddress) return sum;
    return sum + toAmount(vin.value);
  }, 0);

  const received = getVoutList(tx).reduce((sum, vout) => {
    const addresses = getVoutAddresses(vout);
    if (!addresses.includes(focusAddress)) return sum;
    return sum + toAmount(vout.value);
  }, 0);

  const net = received - sent;

  if (sent > NET_TOLERANCE && received > NET_TOLERANCE) {
    if (net > NET_TOLERANCE) {
      return { label: 'Self / Stake In', tone: 'success', sent, received, net };
    }
    if (net < -NET_TOLERANCE) {
      return { label: 'Self / Change Out', tone: 'warning', sent, received, net };
    }
    return { label: 'Self Transfer', tone: 'warning', sent, received, net };
  }

  if (received > NET_TOLERANCE) {
    return { label: 'Received', tone: 'success', sent, received, net };
  }

  if (sent > NET_TOLERANCE) {
    return { label: 'Sent', tone: 'error', sent, received, net };
  }

  return {
    label: tx.isCoinbase ? 'Reward' : 'Observed',
    tone: tx.isCoinbase ? 'success' : 'neutral',
    sent,
    received,
    net,
  };
}

function FlowNode({ entry }: { entry: FlowEntry }) {
  const href = typeof entry.href === 'string'
    ? entry.href
    : entry.address
      ? `/searchv2?q=${encodeURIComponent(entry.address)}`
      : null;

  return (
    <div className={`searchv2-flow-node ${entry.isFocus ? 'focus' : ''}`}>
      <span className="searchv2-flow-node-amount">{formatCoin(entry.amount)} DFCN</span>
      {href ? (
        <Link
          to={href}
          className="searchv2-flow-node-address mono"
          title={entry.isFocus ? 'Open transaction details' : 'Open address in SearchV2'}
        >
          {entry.address ? truncateHash(entry.address, 14) : entry.label}
        </Link>
      ) : (
        <span className="searchv2-flow-node-address">{entry.label}</span>
      )}
      {entry.isFocus && <span className="searchv2-flow-node-tag">matched address</span>}
    </div>
  );
}

function FlowCard({ tx, focusAddress }: { tx: TxView; focusAddress?: string }) {
  const inputs = buildInputEntries(tx, focusAddress);
  const outputs = buildOutputEntries(tx, focusAddress);
  const direction = getDirectionSummary(tx, focusAddress);
  const txTotalIn =
    typeof tx.totalValueIn === 'number'
      ? tx.totalValueIn
      : inputs.reduce((sum, input) => sum + input.amount, 0);
  const txTotalOut =
    typeof tx.totalValueOut === 'number'
      ? tx.totalValueOut
      : outputs.reduce((sum, output) => sum + output.amount, 0);
  const txFee = typeof tx.fee === 'number' ? tx.fee : Math.max(txTotalIn - txTotalOut, 0);
  const netSign = direction.net > NET_TOLERANCE ? '+' : direction.net < -NET_TOLERANCE ? '-' : '';

  const resolveFlowAddressHref = (address: string | null, isFocus: boolean): string | null => {
    if (!address) return null;
    if (isFocus && focusAddress) {
      // Already on this address view; drill into tx details instead of no-op navigation.
      return `/searchv2?q=${encodeURIComponent(tx.txid)}`;
    }
    return `/searchv2?q=${encodeURIComponent(address)}`;
  };

  return (
    <article className="card searchv2-flow-card">
      <div className="searchv2-flow-header">
        <div className="searchv2-flow-hashline">
          <HiOutlineArrowsRightLeft />
          <Link to={`/searchv2?q=${encodeURIComponent(tx.txid)}`} className="hash mono">
            {truncateHash(tx.txid, 26)}
          </Link>
          {tx.isDonation && <span className="badge donate">Donate</span>}
        </div>

        <div className="searchv2-flow-meta">
          <span className={`badge ${direction.tone !== 'neutral' ? direction.tone : ''}`}>{direction.label}</span>
          <span className="searchv2-flow-meta-item">
            <HiOutlineCube />
            <Link to={`/searchv2?q=${encodeURIComponent(String(tx.blockheight))}`} className="hash">
              #{formatNumber(tx.blockheight)}
            </Link>
          </span>
          <span className="searchv2-flow-meta-item">
            <HiOutlineClock />
            {formatAge(tx.blocktime)} ({formatDate(tx.blocktime)})
          </span>
          <span className="searchv2-flow-meta-item">{formatNumber(tx.confirmations)} confirmations</span>
        </div>
      </div>

      <div className="searchv2-flow-grid">
        <div className="searchv2-flow-column">
          <p className="searchv2-flow-column-title">
            {formatNumber(inputs.length)} input{inputs.length === 1 ? '' : 's'} consumed
          </p>
          <div className="searchv2-flow-list">
            {inputs.slice(0, FLOW_ENTRY_PREVIEW_LIMIT).map((entry) => (
              <FlowNode
                key={entry.key}
                entry={{
                  ...entry,
                  href: resolveFlowAddressHref(entry.address, entry.isFocus),
                }}
              />
            ))}
          </div>
          {inputs.length > FLOW_ENTRY_PREVIEW_LIMIT && (
            <p className="searchv2-flow-more">+{formatNumber(inputs.length - FLOW_ENTRY_PREVIEW_LIMIT)} more inputs</p>
          )}
        </div>

        <div className="searchv2-flow-middle" aria-hidden="true">
          <span className="searchv2-flow-dot" />
          <span className="searchv2-flow-dot" />
          <span className="searchv2-flow-dot" />
          <HiOutlineArrowRight className="searchv2-flow-arrow" />
        </div>

        <div className="searchv2-flow-column">
          <p className="searchv2-flow-column-title">
            {formatNumber(outputs.length)} output{outputs.length === 1 ? '' : 's'} created
          </p>
          <div className="searchv2-flow-list">
            {outputs.slice(0, FLOW_ENTRY_PREVIEW_LIMIT).map((entry) => (
              <FlowNode
                key={entry.key}
                entry={{
                  ...entry,
                  href: resolveFlowAddressHref(entry.address, entry.isFocus),
                }}
              />
            ))}
          </div>
          {outputs.length > FLOW_ENTRY_PREVIEW_LIMIT && (
            <p className="searchv2-flow-more">
              +{formatNumber(outputs.length - FLOW_ENTRY_PREVIEW_LIMIT)} more outputs
            </p>
          )}
        </div>
      </div>

      <div className="searchv2-flow-footer">
        <span className="searchv2-flow-metric">
          Value transacted: <strong>{formatCoin(txTotalOut)} DFCN</strong>
        </span>
        <span className="searchv2-flow-metric">
          Total in: <strong>{formatCoin(txTotalIn)} DFCN</strong>
        </span>
        <span className="searchv2-flow-metric">
          Fee: <strong>{formatCoin(txFee)} DFCN</strong>
        </span>
        {focusAddress && (
          <span
            className={`searchv2-flow-metric searchv2-flow-net ${
              direction.net > NET_TOLERANCE ? 'positive' : direction.net < -NET_TOLERANCE ? 'negative' : 'flat'
            }`}
          >
            Net on this address: <strong>{netSign}{formatCoin(Math.abs(direction.net))} DFCN</strong>
          </span>
        )}
      </div>
    </article>
  );
}

export default function SearchV2Page() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = (searchParams.get('q') || '').trim();
  const [draftQuery, setDraftQuery] = useState(query);
  const [addressPage, setAddressPage] = useState(1);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  const searchLookup = useQuery({
    queryKey: ['search-v2', query],
    queryFn: () => fetchSearch(query),
    enabled: query.length > 0,
    retry: false,
  });
  const searchResult = searchLookup.data ?? null;
  const rawSearchError =
    searchLookup.error != null ? getErrorMessage(searchLookup.error, 'No matching block, tx, or address found.') : null;
  const searching = searchLookup.isLoading || searchLookup.isFetching;

  const queryLooksLikeTxid = HEX64_RE.test(query);
  const queryLooksLikeAddress = isLikelyDfcnAddress(query);
  const txid = searchResult?.type === 'transaction' ? searchResult.result.txid : queryLooksLikeTxid ? query : '';
  const address = searchResult?.type === 'address' ? searchResult.result.address : queryLooksLikeAddress ? query : '';
  const shouldSuppressSearchError = Boolean(rawSearchError) && (queryLooksLikeTxid || queryLooksLikeAddress);
  const searchError = shouldSuppressSearchError ? null : rawSearchError;
  const blockMatch = searchResult?.type === 'block' ? searchResult.result : null;

  useEffect(() => {
    setAddressPage(1);
  }, [address]);

  const txQuery = useQuery({
    queryKey: ['search-v2-transaction', txid],
    queryFn: () => fetchTransaction(txid),
    enabled: txid.length > 0,
  });
  const transaction = txQuery.data ?? null;
  const txError =
    txQuery.error != null ? getErrorMessage(txQuery.error, 'Transaction details could not be loaded.') : null;
  const txLoading = txQuery.isLoading || txQuery.isFetching;

  const addressQuery = useQuery({
    queryKey: ['search-v2-address', address],
    queryFn: () => fetchAddress(address),
    enabled: address.length > 0,
  });
  const addressInfo = addressQuery.data ?? null;
  const addressError =
    addressQuery.error != null ? getErrorMessage(addressQuery.error, 'Address details could not be loaded.') : null;
  const addressLoading = addressQuery.isLoading || addressQuery.isFetching;

  const addressTxsQuery = useQuery({
    queryKey: ['search-v2-address-txs', address, addressPage],
    queryFn: () => fetchAddressTxs(address, addressPage, ADDRESS_TX_PAGE_SIZE),
    enabled: address.length > 0,
    placeholderData: keepPreviousData,
  });
  const addressTxData = addressTxsQuery.data;
  const addressTxs = (addressTxData?.data || []) as TxView[];
  const addressPagination = addressTxData?.pagination;
  const addressTxLoading = addressTxsQuery.isLoading || addressTxsQuery.isFetching;
  const addressTxError =
    addressTxsQuery.error != null ? getErrorMessage(addressTxsQuery.error, 'Address transactions could not be loaded.') : null;

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = draftQuery.trim();
    if (!normalized) {
      setSearchParams({});
      return;
    }
    setSearchParams({ q: normalized });
  };

  const transactionSummary = transaction
    ? {
        totalOut: typeof transaction.totalValueOut === 'number' ? transaction.totalValueOut : 0,
        totalIn: typeof transaction.totalValueIn === 'number' ? transaction.totalValueIn : 0,
        fee: typeof transaction.fee === 'number' ? transaction.fee : 0,
      }
    : null;

  return (
    <div className="fade-in searchv2-page">
      <div className="page-header">
        <h1 className="page-title">
          <HiOutlineMagnifyingGlass /> SearchV2
        </h1>
        <p className="page-subtitle">Address and transaction flow explorer with clear from-to-value-time breakdown.</p>
      </div>

      <div className="card searchv2-query-card">
        <form onSubmit={handleSearchSubmit} className="searchv2-query-form">
          <div className="search-container searchv2-query-input">
            <HiOutlineMagnifyingGlass className="search-icon" />
            <input
              type="search"
              className="search-input"
              placeholder="Search by tx hash or address"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary">Analyze Flow</button>
        </form>
        <p className="searchv2-query-help">
          Enter a DeFCoN tx hash or address to inspect source, destination, amount movement, and timing.
        </p>
      </div>

      {!query && (
        <div className="card searchv2-state-card">
          <div className="placeholder-content">
            <div className="placeholder-icon">
              <HiOutlineMagnifyingGlass />
            </div>
            <h2>Start with a tx hash or address</h2>
            <p>SearchV2 highlights where funds came from, where they went, how much moved, and when it happened.</p>
          </div>
        </div>
      )}

      {query && searching && (
        <div className="card searchv2-state-card">
          <div className="placeholder-content">
            <div className="placeholder-icon pulse">
              <HiOutlineMagnifyingGlass />
            </div>
            <h2>Searching chain data...</h2>
            <p>Scanning blocks, transactions, and addresses for "{query}".</p>
          </div>
        </div>
      )}

      {query && !searching && searchError && (
        <div className="card searchv2-state-card">
          <div className="placeholder-content">
            <div className="placeholder-icon">
              <HiOutlineMagnifyingGlass />
            </div>
            <h2>No result</h2>
            <p>{searchError}</p>
            <div className="searchv2-state-actions">
              <Link to="/txs" className="btn btn-secondary">Latest Transactions</Link>
              <Link to="/richlist" className="btn btn-secondary">Rich List</Link>
            </div>
          </div>
        </div>
      )}

      {query && !searching && !searchError && blockMatch && (
        <div className="card searchv2-state-card">
          <div className="searchv2-block-match">
            <div>
              <h2 className="card-title">
                <HiOutlineCube /> Block match found
              </h2>
              <p className="searchv2-block-text">
                Search matched block <span className="mono">{formatNumber(blockMatch.height)}</span> ({truncateHash(blockMatch.hash, 16)}).
              </p>
            </div>
            <Link to={`/block/${encodeURIComponent(String(blockMatch.height))}`} className="btn btn-primary">
              Open block
            </Link>
          </div>
        </div>
      )}

      {query && !searching && !searchError && txid.length > 0 && (
        <>
          {txLoading && (
            <div className="card searchv2-state-card">
              <div className="placeholder-content">
                <h2>Loading transaction details...</h2>
              </div>
            </div>
          )}

          {!txLoading && txError && (
            <div className="card searchv2-state-card">
              <div className="placeholder-content">
                <h2>Transaction load failed</h2>
                <p>{txError}</p>
              </div>
            </div>
          )}

          {!txLoading && !txError && transaction && transactionSummary && (
            <>
              <div className="card searchv2-summary-strip">
                <div className="searchv2-summary-grid">
                  <div className="searchv2-summary-item">
                    <span className="searchv2-summary-label">Received</span>
                    <strong className="searchv2-summary-value">
                      <HiOutlineClock /> {formatAge(transaction.blocktime)}
                    </strong>
                    <span className="searchv2-summary-subtle">{formatDate(transaction.blocktime)}</span>
                  </div>
                  <div className="searchv2-summary-item">
                    <span className="searchv2-summary-label">Total Transacted</span>
                    <strong className="searchv2-summary-value">{formatCoin(transactionSummary.totalOut)} DFCN</strong>
                    <span className="searchv2-summary-subtle">Value out</span>
                  </div>
                  <div className="searchv2-summary-item">
                    <span className="searchv2-summary-label">Total Input</span>
                    <strong className="searchv2-summary-value">{formatCoin(transactionSummary.totalIn)} DFCN</strong>
                    <span className="searchv2-summary-subtle">Value in</span>
                  </div>
                  <div className="searchv2-summary-item">
                    <span className="searchv2-summary-label">Total Fees</span>
                    <strong className="searchv2-summary-value">{formatCoin(transactionSummary.fee)} DFCN</strong>
                    <span className="searchv2-summary-subtle">{formatNumber(transaction.confirmations)} confirmations</span>
                  </div>
                </div>
              </div>

              <FlowCard tx={transaction} />
            </>
          )}
        </>
      )}

      {query && !searching && !searchError && address.length > 0 && (
        <>
          {addressLoading && (
            <div className="card searchv2-state-card">
              <div className="placeholder-content">
                <h2>Loading address details...</h2>
              </div>
            </div>
          )}

          {!addressLoading && addressError && (
            <div className="card searchv2-state-card">
              <div className="placeholder-content">
                <h2>Address load failed</h2>
                <p>{addressError}</p>
              </div>
            </div>
          )}

          {!addressLoading && !addressError && addressInfo && (
            <>
              <div className="grid-stats searchv2-address-stats">
                <article className="stat-card">
                  <div className="stat-label">
                    <HiOutlineWallet /> Address
                  </div>
                  <div className="stat-value searchv2-address-hash mono" title={addressInfo.address}>
                    {addressInfo.address}
                  </div>
                  <div className="stat-change">Tracked on chain</div>
                </article>
                <article className="stat-card">
                  <div className="stat-label">
                    <HiOutlineBanknotes /> Balance
                  </div>
                  <div className="stat-value">{formatCoin(addressInfo.balance)}</div>
                  <div className="stat-change">DFCN</div>
                </article>
                <article className="stat-card">
                  <div className="stat-label">
                    <HiOutlineArrowDownTray /> Total Received
                  </div>
                  <div className="stat-value searchv2-positive">{formatCoin(addressInfo.totalReceived)}</div>
                  <div className="stat-change">DFCN</div>
                </article>
                <article className="stat-card">
                  <div className="stat-label">
                    <HiOutlineArrowUpTray /> Total Sent
                  </div>
                  <div className="stat-value searchv2-negative">{formatCoin(addressInfo.totalSent)}</div>
                  <div className="stat-change">DFCN</div>
                </article>
              </div>

              <div className="card searchv2-address-flows">
                <div className="card-header">
                  <h2 className="card-title">
                    <HiOutlineArrowsRightLeft /> Transaction Flows
                  </h2>
                  <span className="searchv2-address-total">
                    {formatNumber(
                      addressInfo.txCount ??
                        addressPagination?.total ??
                        addressTxs.length
                    )}{' '}
                    total transaction
                    {(addressInfo.txCount ?? addressPagination?.total ?? addressTxs.length) === 1 ? '' : 's'}
                  </span>
                </div>

                {addressTxLoading && (
                  <div className="searchv2-inline-state">Loading transactions for this address...</div>
                )}

                {!addressTxLoading && addressTxError && (
                  <div className="searchv2-inline-state">{addressTxError}</div>
                )}

                {!addressTxLoading && !addressTxError && addressTxs.length === 0 && (
                  <div className="searchv2-inline-state">No transactions found for this address yet.</div>
                )}

                {!addressTxLoading && !addressTxError && addressTxs.length > 0 && (
                  <>
                    <div className="searchv2-flow-listing">
                      {addressTxs.map((tx) => (
                        <FlowCard key={tx.txid} tx={tx} focusAddress={address} />
                      ))}
                    </div>

                    {(addressPagination?.pages || 1) > 1 && (
                      <div className="pagination">
                        <button onClick={() => setAddressPage((current) => current - 1)} disabled={addressPage <= 1}>
                          &lsaquo;
                        </button>
                        <span className="searchv2-pagination-label">
                          Page {formatNumber(addressPage)} of {formatNumber(addressPagination?.pages || 1)}
                        </span>
                        <button
                          onClick={() => setAddressPage((current) => current + 1)}
                          disabled={addressPage >= (addressPagination?.pages || 1)}
                        >
                          &rsaquo;
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {!addressLoading && addressError && (
            <div className="card searchv2-address-flows">
              <div className="card-header">
                <h2 className="card-title">
                  <HiOutlineArrowsRightLeft /> Transaction Flows
                </h2>
                <span className="searchv2-address-total mono">{truncateHash(address, 16)}</span>
              </div>
              <div className="searchv2-inline-state">
                Address summary is not indexed yet. Showing transactions where this address appears.
              </div>

              {addressTxLoading && (
                <div className="searchv2-inline-state">Loading transactions for this address...</div>
              )}

              {!addressTxLoading && addressTxError && (
                <div className="searchv2-inline-state">{addressTxError}</div>
              )}

              {!addressTxLoading && !addressTxError && addressTxs.length === 0 && (
                <div className="searchv2-inline-state">No indexed transactions found for this address yet.</div>
              )}

              {!addressTxLoading && !addressTxError && addressTxs.length > 0 && (
                <>
                  <div className="searchv2-flow-listing">
                    {addressTxs.map((tx) => (
                      <FlowCard key={tx.txid} tx={tx} focusAddress={address} />
                    ))}
                  </div>

                  {(addressPagination?.pages || 1) > 1 && (
                    <div className="pagination">
                      <button onClick={() => setAddressPage((current) => current - 1)} disabled={addressPage <= 1}>
                        &lsaquo;
                      </button>
                      <span className="searchv2-pagination-label">
                        Page {formatNumber(addressPage)} of {formatNumber(addressPagination?.pages || 1)}
                      </span>
                      <button
                        onClick={() => setAddressPage((current) => current + 1)}
                        disabled={addressPage >= (addressPagination?.pages || 1)}
                      >
                        &rsaquo;
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
