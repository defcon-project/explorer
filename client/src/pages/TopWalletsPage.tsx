import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { HiOutlineWallet } from 'react-icons/hi2';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchRichList, fetchStats } from '../services/api';
import { useChartAnimation } from '../utils/chartAnimation';
import { formatNumber, truncateHash } from '../utils/formatters';
import { useTheme } from '../context/ThemeContext';
import './PageStyles.css';

type RangeKey = 'lt200m' | '200m-400m' | '400m-650m' | '650m+';

interface RangeDef {
  key: RangeKey;
  label: string;
  min: number;
  max?: number;
}

const rangeDefs: RangeDef[] = [
  { key: 'lt200m', label: '<200M', min: 0, max: 200_000_000 },
  { key: '200m-400m', label: '200M-400M', min: 200_000_000, max: 400_000_000 },
  { key: '400m-650m', label: '400M-650M', min: 400_000_000, max: 650_000_000 },
  { key: '650m+', label: '650M+', min: 650_000_000 },
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

function inRange(balance: number, range: RangeDef): boolean {
  if (typeof range.max === 'number') {
    return balance >= range.min && balance < range.max;
  }
  return balance >= range.min;
}

export default function TopWalletsPage() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const chartColor = theme === 'dark' ? '#7ab9ff' : '#2f8fff';
  const [selectedRange, setSelectedRange] = useState<RangeKey | null>(null);
  const chartAnimation = useChartAnimation();

  const { data: richData, isLoading: loading } = useQuery({
    queryKey: ['richlist', 1, 20],
    queryFn: () => fetchRichList(1, 20),
    staleTime: 90_000,
  });
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    staleTime: 90_000,
  });

  const top20Addresses = useMemo(() => richData?.data || [], [richData?.data]);
  const top20Total = useMemo(
    () => top20Addresses.reduce((sum, address) => sum + (address.balance || 0), 0),
    [top20Addresses]
  );
  const supply = stats?.supply?.circulating || top20Total || 1;

  const distributionData = useMemo(() => {
    const dark = theme === 'dark';
    const slices = top20Addresses.map((entry, index) => {
      const t = top20Addresses.length <= 1 ? 0 : index / (top20Addresses.length - 1);
      const lightness = dark ? 68 - t * 30 : 30 + t * 38;
      return {
        name: `#${entry.rank}`,
        address: entry.address as string | null,
        balance: entry.balance || 0,
        value: supply > 0 ? ((entry.balance || 0) / supply) * 100 : 0,
        color: `hsl(212, 82%, ${lightness}%)`,
      };
    });

    const topPercentage = slices.reduce((sum, slice) => sum + slice.value, 0);
    slices.push({
      name: 'Others',
      address: null,
      balance: Math.max(0, supply - top20Total),
      value: Math.max(0, 100 - topPercentage),
      color: dark ? 'hsl(215, 18%, 38%)' : 'hsl(215, 35%, 82%)',
    });

    return slices;
  }, [supply, theme, top20Addresses, top20Total]);

  const balanceRanges = useMemo(
    () =>
      rangeDefs.map((range) => ({
        range: range.label,
        key: range.key,
        count: top20Addresses.filter((address) => inRange(address.balance, range)).length,
      })),
    [top20Addresses]
  );

  const filteredAddresses = useMemo(() => {
    if (!selectedRange) return top20Addresses;
    const range = rangeDefs.find((item) => item.key === selectedRange);
    if (!range) return top20Addresses;
    return top20Addresses.filter((address) => inRange(address.balance, range));
  }, [top20Addresses, selectedRange]);

  const toggleRange = (key: RangeKey) => {
    setSelectedRange((prev) => (prev === key ? null : key));
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">
          <HiOutlineWallet /> Top Wallets
        </h1>
        <p className="page-subtitle">Wealth distribution across the DeFCoN network</p>
      </div>

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Supply Distribution</h2>
          </div>
          {top20Addresses.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={distributionData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={55}
                    paddingAngle={1}
                    dataKey="value"
                    labelLine={false}
                    label={({ name, value }) => ((value ?? 0) >= 3 ? `${name}: ${(value ?? 0).toFixed(1)}%` : '')}
                    {...chartAnimation}
                  >
                    {distributionData.map((entry) => {
                      const address = entry.address;
                      return (
                        <Cell
                          key={entry.name}
                          fill={entry.color}
                          onClick={
                            address
                              ? () => navigate(`/searchv2?q=${encodeURIComponent(address)}`)
                              : undefined
                          }
                          style={address ? { cursor: 'pointer' } : undefined}
                        />
                      );
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={chartTooltipTextStyle}
                    itemStyle={chartTooltipTextStyle}
                    formatter={(value: number, _name, item) => {
                      const datum = (item?.payload ?? {}) as {
                        name?: string;
                        address?: string | null;
                        balance?: number;
                      };
                      const label = datum.address
                        ? `${datum.name ?? ''} ${truncateHash(datum.address, 10)}`
                        : 'Others';
                      return [
                        `${value.toFixed(2)}% (${formatNumber(datum.balance ?? 0, 0)} DFCN)`,
                        label,
                      ];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-muted" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
                Each slice is one of the top 20 wallets. Click a slice to open that wallet.
              </div>
            </>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading distribution...
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Balance Distribution of Top 20 Wallets</h2>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={balanceRanges} layout="vertical">
              <XAxis type="number" stroke="var(--text-muted)" fontSize={12} />
              <YAxis dataKey="range" type="category" stroke="var(--text-muted)" fontSize={12} width={92} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                labelStyle={chartTooltipTextStyle}
                itemStyle={chartTooltipTextStyle}
                formatter={(value: number) => [formatNumber(value), 'Addresses']}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} {...chartAnimation}>
                {balanceRanges.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={chartColor}
                    onClick={() => toggleRange(entry.key)}
                    style={{ cursor: 'pointer' }}
                    opacity={selectedRange && selectedRange !== entry.key ? 0.35 : 1}
                    stroke={selectedRange === entry.key ? 'var(--text-primary)' : undefined}
                    strokeWidth={selectedRange === entry.key ? 2 : 0}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="text-muted" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }}>
            Click a range bar to filter the top 20 wallet list.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            {selectedRange ? `Top 20 Wallets in ${selectedRange}` : 'Top 20 Wallets'}
          </h2>
          {selectedRange && (
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSelectedRange(null)}>
              Show all
            </button>
          )}
        </div>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
        ) : filteredAddresses.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No wallets in this range
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Address</th>
                  <th>Balance (DFCN)</th>
                  <th>% of Supply</th>
                  <th>TX Count</th>
                </tr>
              </thead>
              <tbody>
                {filteredAddresses.map((entry) => {
                  const pct = supply > 0 ? (entry.balance / supply) * 100 : 0;
                  return (
                    <tr key={entry.rank}>
                      <td>
                        <span className={`badge ${entry.rank <= 3 ? 'warning' : ''}`}>#{entry.rank}</span>
                      </td>
                      <td>
                        <Link to={`/searchv2?q=${encodeURIComponent(entry.address)}`} className="hash mono">
                          {truncateHash(entry.address, 12)}
                        </Link>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {formatNumber(entry.balance, 2)}
                      </td>
                      <td>{pct.toFixed(2)}%</td>
                      <td>{formatNumber(entry.txCount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
