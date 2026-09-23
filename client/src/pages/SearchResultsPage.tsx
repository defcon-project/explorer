import { useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { HiOutlineMagnifyingGlass, HiOutlineCube, HiOutlineWallet } from 'react-icons/hi2';
import { useQuery } from '@tanstack/react-query';
import { fetchSearch } from '../services/api';
import './PageStyles.css';

export default function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';

  const searchQuery = useQuery({
    queryKey: ['search', query],
    queryFn: () => fetchSearch(query),
    enabled: query.length > 0,
  });
  const data = searchQuery.data ?? null;
  const loading = searchQuery.isLoading || searchQuery.isFetching;
  const error =
    searchQuery.error != null
      ? ((searchQuery.error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
          (searchQuery.error as Error)?.message ||
          'Search failed')
      : null;

  // Auto-redirect to the right page if found
  useEffect(() => {
    if (!data) return;
    if (data.type === 'block') {
      navigate(`/searchv2?q=${encodeURIComponent(String(data.result.height))}`, { replace: true });
    } else if (data.type === 'transaction') {
      navigate(`/searchv2?q=${encodeURIComponent(data.result.txid)}`, { replace: true });
    } else if (data.type === 'address') {
      navigate(`/searchv2?q=${encodeURIComponent(data.result.address)}`, { replace: true });
    }
  }, [data, navigate]);

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title"><HiOutlineMagnifyingGlass /> Search Results</h1>
        <p className="page-subtitle">
          Results for: <span className="mono value-highlight">{query}</span>
        </p>
      </div>

      <div className="card">
        {!query ? (
          <div className="placeholder-content">
            <div className="placeholder-icon"><HiOutlineMagnifyingGlass /></div>
            <h2>Enter a Search Query</h2>
            <p>Search by block height, block hash, transaction ID, or address</p>
          </div>
        ) : loading ? (
          <div className="placeholder-content">
            <div className="placeholder-icon"><HiOutlineMagnifyingGlass /></div>
            <h2>Searching...</h2>
            <p>Looking for "{query}" in blocks, transactions, and addresses</p>
          </div>
        ) : error ? (
          <div className="placeholder-content">
            <div className="placeholder-icon"><HiOutlineMagnifyingGlass /></div>
            <h2>No Results Found</h2>
            <p>No blocks, transactions, or addresses match "{query}"</p>
            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/blocks" className="btn btn-secondary">
                <HiOutlineCube /> Browse Blocks
              </Link>
              <Link to="/richlist" className="btn btn-secondary">
                <HiOutlineWallet /> Rich List
              </Link>
            </div>
          </div>
        ) : (
          <div className="placeholder-content">
            <div className="placeholder-icon"><HiOutlineMagnifyingGlass /></div>
            <h2>Redirecting...</h2>
          </div>
        )}
      </div>
    </div>
  );
}
