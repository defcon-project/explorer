import { useMemo, useState } from 'react';
import {
  HiOutlineGlobeAlt,
  HiOutlineMapPin,
  HiOutlineServerStack,
  HiOutlineTag,
} from 'react-icons/hi2';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  CartesianGrid,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import {
  fetchMasternodeDistribution,
  fetchMasternodeNodes,
  fetchMasternodeSummary,
} from '../services/api';
import { useChartAnimation } from '../utils/chartAnimation';
import { formatAge, formatNumber } from '../utils/formatters';
import './PageStyles.css';
import './MasternodesPage.css';

interface ChartSlice {
  name: string;
  value: number;
  color: string;
  countryCode: string;
}

interface ProviderChartSlice {
  name: string;
  tagged: number;
  auto: number;
  total: number;
  provider: string;
}

type MnFilter =
  | { type: 'country'; value: string; label: string }
  | { type: 'provider'; value: string; label: string }
  | null;

const chartColors = [
  '#1f64d8',
  '#2f8fff',
  '#58a8ff',
  '#4f7fd8',
  '#5cbfff',
  '#3f6fc6',
  '#79b6ff',
  '#2f5fae',
];

const chartTooltipStyle = {
  background: 'var(--surface-elevated)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  boxShadow: 'var(--card-shadow)',
} as const;

const chartTooltipTextStyle = {
  color: 'var(--text)',
} as const;

const OTHERS_KEY = '__others';

function isActiveMasternodeStatus(status: string | null | undefined): boolean {
  const normalized = String(status || '').trim().toUpperCase();
  return normalized === 'ENABLED' || normalized === 'POSE_PENALTY';
}

function statusLabel(status: string | null | undefined): string {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'POSE_PENALTY') return 'PoSe Penalty';
  if (normalized === 'ENABLED') return 'Enabled';
  return normalized || 'Unknown';
}

function shortService(node: { ip?: string | null; port?: number | null; service?: string | null }): string {
  if (node.ip) return node.port ? `${node.ip}:${node.port}` : node.ip;
  return node.service || 'Unknown';
}

export default function MasternodesPage() {
  const [activeFilter, setActiveFilter] = useState<MnFilter>(null);
  const summaryQuery = useQuery({
    queryKey: ['masternodes', 'summary'],
    queryFn: fetchMasternodeSummary,
    staleTime: 60_000,
  });
  const distributionQuery = useQuery({
    queryKey: ['masternodes', 'distribution'],
    queryFn: fetchMasternodeDistribution,
    staleTime: 60_000,
  });
  const nodesQuery = useQuery({
    queryKey: ['masternodes', 'nodes', 'active-list'],
    queryFn: () => fetchMasternodeNodes({ limit: 500 }),
    staleTime: 60_000,
  });
  const chartAnimation = useChartAnimation();

  const summary = summaryQuery.data;
  const countries = distributionQuery.data?.countries || [];
  const providers = distributionQuery.data?.providers || [];
  const nodes = nodesQuery.data?.nodes || [];

  const loading = summaryQuery.isLoading || distributionQuery.isLoading;
  const nodesLoading = nodesQuery.isLoading;
  const error =
    summaryQuery.error != null || distributionQuery.error != null || nodesQuery.error != null
      ? (((summaryQuery.error || distributionQuery.error || nodesQuery.error) as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
          ((summaryQuery.error || distributionQuery.error || nodesQuery.error) as Error)?.message ||
          'Failed to load masternodes')
      : null;

  const topCountries = useMemo(() => countries.slice(0, 8), [countries]);

  const chartData: ChartSlice[] = useMemo(() => {
    const rows: ChartSlice[] = topCountries.map((country, index) => ({
      name: country.countryName,
      value: country.count,
      color: chartColors[index % chartColors.length],
      countryCode: country.countryCode,
    }));

    const restCount = countries.slice(8).reduce((sum, item) => sum + item.count, 0);
    if (restCount > 0) {
      rows.push({
        name: 'Others',
        value: restCount,
        color: '#6f8eb2',
        countryCode: OTHERS_KEY,
      });
    }

    return rows;
  }, [countries, topCountries]);

  const providerChartData: ProviderChartSlice[] = useMemo(
    () =>
      providers.slice(0, 10).map((provider) => ({
        name: provider.provider,
        tagged: provider.tagged ?? 0,
        auto: provider.auto ?? provider.count,
        total: provider.count,
        provider: provider.provider,
      })),
    [providers],
  );

  const topCountryCodes = useMemo(() => new Set(topCountries.map((country) => country.countryCode)), [topCountries]);

  const activeNodes = useMemo(
    () => nodes.filter((node) => isActiveMasternodeStatus(node.status)),
    [nodes],
  );

  const visibleNodes = useMemo(() => {
    if (!activeFilter) return activeNodes;
    if (activeFilter.type === 'country') {
      if (activeFilter.value === OTHERS_KEY) {
        return activeNodes.filter((node) => !topCountryCodes.has(node.countryCode));
      }
      return activeNodes.filter((node) => node.countryCode === activeFilter.value);
    }
    return activeNodes.filter((node) => node.provider === activeFilter.value);
  }, [activeFilter, activeNodes, topCountryCodes]);

  const handleCountryFilter = (entry: ChartSlice) => {
    setActiveFilter((current) =>
      current?.type === 'country' && current.value === entry.countryCode
        ? null
        : { type: 'country', value: entry.countryCode, label: entry.name },
    );
  };

  const handleProviderFilter = (entry: ProviderChartSlice) => {
    setActiveFilter((current) =>
      current?.type === 'provider' && current.value === entry.provider
        ? null
        : { type: 'provider', value: entry.provider, label: entry.provider },
    );
  };

  const taggedCount = summary?.tagged ?? 0;
  const totalNodes =
    distributionQuery.data?.total ?? summary?.enabled ?? countries.reduce((sum, country) => sum + country.count, 0);
  const enabledNodesCount = summary?.enabled ?? 0;
  const posePenaltyNodesCount = summary?.posePenalty ?? 0;
  const onlineShare = summary?.enabledPct ?? (summary?.total ? (enabledNodesCount / summary.total) * 100 : 0);
  const topCountry = summary?.topCountry ?? countries[0] ?? null;
  const topProvider = summary?.topProvider ?? providers[0] ?? null;
  const taggedCoveragePct = summary?.taggedCoveragePct ?? 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">
          <HiOutlineServerStack /> Masternodes
        </h1>
        <p className="page-subtitle">Live masternode endpoints with country and hosting provider distribution</p>
        <div className="mn-header-pills">
          <span className="mn-header-pill">Live RPC snapshot</span>
          <span className="mn-header-pill">{loading ? 'Loading providers...' : `${taggedCoveragePct.toFixed(1)}% tagged coverage`}</span>
          <span className="mn-header-pill">{loading ? 'Loading health...' : `${onlineShare.toFixed(1)}% active`}</span>
        </div>
      </div>

      <div className="card mn-kpi-shell" style={{ marginBottom: '1.5rem' }}>
        <div className="mn-kpi-grid">
          <div className="mn-kpi-card mn-kpi-card-enabled">
            <div className="mn-kpi-label">
              <HiOutlineMapPin /> Active MN
            </div>
            <div className="mn-kpi-value">{loading ? '...' : formatNumber(enabledNodesCount)}</div>
            <div className="mn-kpi-sub">{loading ? 'Calculating...' : `${onlineShare.toFixed(1)}% of total`}</div>
          </div>

          <div className="mn-kpi-card mn-kpi-card-banned">
            <div className="mn-kpi-label">
              <HiOutlineTag /> PoSe Penalty
            </div>
            <div className="mn-kpi-value">{loading ? '...' : formatNumber(posePenaltyNodesCount)}</div>
            <div className="mn-kpi-sub">Currently receiving penalty points</div>
          </div>

          <div className="mn-kpi-card mn-kpi-card-countries">
            <div className="mn-kpi-label">
              <HiOutlineGlobeAlt /> Countries
            </div>
            <div className="mn-kpi-value">{loading ? '...' : formatNumber(countries.length)}</div>
            <div className="mn-kpi-sub">
              {loading ? 'Loading distribution...' : topCountry ? `Top: ${topCountry.countryName} (${formatNumber(topCountry.count)})` : 'No country data'}
            </div>
          </div>

          <div className="mn-kpi-card mn-kpi-card-tagged">
            <div className="mn-kpi-label">
              <HiOutlineTag /> Tagged Coverage
            </div>
            <div className="mn-kpi-value">{loading ? '...' : `${taggedCoveragePct.toFixed(1)}%`}</div>
            <div className="mn-kpi-sub">
              {loading
                ? 'Loading attribution...'
                : `${formatNumber(taggedCount)} tagged - ${topProvider ? topProvider.provider : 'no top provider'}`}
            </div>
          </div>
        </div>
        <div className="mn-kpi-meta-row mn-kpi-meta-row-compact">
          <span>{loading ? 'Loading region profile...' : `Most common region: ${topCountry ? topCountry.countryName : 'N/A'}`}</span>
          <span>{loading ? 'Loading provider profile...' : `Top provider: ${topProvider ? `${topProvider.provider} (${formatNumber(topProvider.count)})` : 'N/A'}`}</span>
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="text-muted">{error}</p>
        </div>
      ) : null}

      <div className="grid-2 mn-chart-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="card mn-panel-card">
          <div className="card-header">
            <h2 className="card-title">Masternodes by Country</h2>
            <span className="mn-panel-metric">{loading ? '...' : formatNumber(totalNodes)} nodes</span>
          </div>
          <p className="mn-panel-subtitle">Live country distribution from the current masternode snapshot.</p>

          {loading ? (
            <div className="placeholder-content" style={{ padding: '2.5rem' }}>
              <p className="text-muted">Loading country distribution...</p>
            </div>
          ) : chartData.length === 0 ? (
            <div className="placeholder-content" style={{ padding: '2.5rem' }}>
              <p className="text-muted">No country distribution available</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={95}
                  innerRadius={52}
                  dataKey="value"
                  paddingAngle={2}
                  label={({ name, value }) => `${name}: ${value}`}
                  {...chartAnimation}
                >
                    {chartData.map((entry) => (
                      <Cell
                        key={`${entry.countryCode}-${entry.name}`}
                        fill={entry.color}
                        opacity={
                          !activeFilter ||
                          (activeFilter.type === 'country' && activeFilter.value === entry.countryCode)
                            ? 1
                            : 0.35
                        }
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleCountryFilter(entry)}
                      />
                    ))}
                </Pie>
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipTextStyle}
                  itemStyle={chartTooltipTextStyle}
                  formatter={(value: number) => [formatNumber(value), 'Nodes']}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card mn-panel-card">
          <div className="card-header">
            <h2 className="card-title">Hosting Providers</h2>
            <span className="mn-panel-metric">{loading ? '...' : formatNumber(providerChartData.length)} visible providers</span>
          </div>
          <p className="mn-panel-subtitle">Stacked view of auto-detected vs CIDR-tagged provider attribution.</p>
          {loading ? (
            <div className="placeholder-content" style={{ padding: '2.5rem' }}>
              <p className="text-muted">Resolving providers...</p>
            </div>
          ) : providerChartData.length === 0 ? (
            <div className="placeholder-content" style={{ padding: '2.5rem' }}>
              <p className="text-muted">No provider data available</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={providerChartData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid stroke="var(--border-light)" strokeDasharray="3 3" />
                <XAxis type="number" stroke="var(--text-muted)" />
                <YAxis type="category" dataKey="name" stroke="var(--text-muted)" width={120} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={chartTooltipTextStyle}
                  itemStyle={chartTooltipTextStyle}
                  formatter={(value: number, key, item) => {
                    const entry = item.payload as ProviderChartSlice;
                    if (key === 'tagged') {
                      const share = entry.total > 0 ? (entry.tagged / entry.total) * 100 : 0;
                      return [`${formatNumber(value)} tagged (${share.toFixed(1)}%)`, 'Tagged ranges'];
                    }
                    if (key === 'auto') {
                      const share = entry.total > 0 ? (entry.auto / entry.total) * 100 : 0;
                      return [`${formatNumber(value)} auto (${share.toFixed(1)}%)`, 'Auto detected'];
                    }
                    return [formatNumber(value), String(key)];
                  }}
                  labelFormatter={(label, payload) => {
                    const item = payload?.[0]?.payload as ProviderChartSlice | undefined;
                    if (!item) return String(label);
                    return `${item.name} - ${formatNumber(item.total)} nodes`;
                  }}
                />
                <Bar
                  dataKey="auto"
                  stackId="provider"
                  fill="#2f8fff"
                  name="Auto detected"
                  onClick={(entry: { payload?: ProviderChartSlice }) => {
                    if (entry?.payload) handleProviderFilter(entry.payload);
                  }}
                  {...chartAnimation}
                >
                  {providerChartData.map((entry) => (
                    <Cell
                      key={`auto-${entry.provider}`}
                      opacity={
                        !activeFilter ||
                        (activeFilter.type === 'provider' && activeFilter.value === entry.provider)
                          ? 1
                          : 0.35
                      }
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="tagged"
                  stackId="provider"
                  fill="#2bc48a"
                  name="Tagged ranges"
                  onClick={(entry: { payload?: ProviderChartSlice }) => {
                    if (entry?.payload) handleProviderFilter(entry.payload);
                  }}
                  {...chartAnimation}
                >
                  {providerChartData.map((entry) => (
                    <Cell
                      key={`tagged-${entry.provider}`}
                      opacity={
                        !activeFilter ||
                        (activeFilter.type === 'provider' && activeFilter.value === entry.provider)
                          ? 1
                          : 0.35
                      }
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card mn-panel-card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Active Masternodes</h2>
            <p className="mn-panel-subtitle">ENABLED and POSE_PENALTY nodes only.</p>
          </div>
          <div className="mn-active-filter-actions">
            <span className="mn-panel-metric">
              {nodesLoading ? '...' : `${formatNumber(visibleNodes.length)} visible`}
            </span>
            {activeFilter && (
              <>
                <span className="badge badge-accent">
                  {activeFilter.type === 'country' ? 'Country' : 'Provider'}: {activeFilter.label}
                </span>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setActiveFilter(null)}>
                  Show all
                </button>
              </>
            )}
          </div>
        </div>

        {nodesLoading ? (
          <div className="placeholder-content" style={{ padding: '2.5rem' }}>
            <p className="text-muted">Loading active masternodes...</p>
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="placeholder-content" style={{ padding: '2.5rem' }}>
            <p className="text-muted">No active masternodes match this filter.</p>
          </div>
        ) : (
          <div className="table-wrapper mn-active-table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Country</th>
                  <th>Provider</th>
                  <th>Source</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map((node) => (
                  <tr key={node.id}>
                    <td>
                      <div className="mono mn-service-cell">{shortService(node)}</div>
                    </td>
                    <td>
                      <span className={`badge ${node.status === 'POSE_PENALTY' ? 'warning' : 'success'}`}>
                        {statusLabel(node.status)}
                      </span>
                    </td>
                    <td>
                      <span>{node.countryName || 'Unknown'}</span>
                      <span className="text-muted mono mn-country-code">{node.countryCode || 'XX'}</span>
                    </td>
                    <td>{node.provider || 'Unknown'}</td>
                    <td>
                      <span className={node.providerSource === 'tag' ? 'mn-tag-pill' : 'badge'}>
                        {node.providerSource === 'tag' ? 'Tagged' : 'Auto'}
                      </span>
                    </td>
                    <td className="text-muted">
                      {typeof node.lastSeen === 'number' ? formatAge(node.lastSeen) : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

