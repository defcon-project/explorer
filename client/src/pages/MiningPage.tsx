import {
  HiOutlineCpuChip,
  HiOutlineArrowTrendingUp,
  HiOutlineClock,
  HiOutlineBanknotes,
  HiOutlineServerStack,
  HiOutlineWallet,
  HiOutlineCalculator,
  HiOutlineChartBarSquare,
  HiOutlineLockClosed,
} from 'react-icons/hi2';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchCoin, fetchLatestBlocks, fetchMasternodeSummary, fetchStats } from '../services/api';
import { useChartAnimation } from '../utils/chartAnimation';
import { formatNumber, formatDifficulty, formatSmallPrice } from '../utils/formatters';
import { useTheme } from '../context/ThemeContext';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { useMarketSnapshot } from '../hooks/useMarketSnapshot';
import './PageStyles.css';
import './MiningPage.css';

function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'N/A';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export default function MiningPage() {
  const { theme } = useTheme();
  const chartColor = theme === 'dark' ? '#7ab9ff' : '#2f8fff';
  const isPageVisible = usePageVisibility();
  const chartAnimation = useChartAnimation();

  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: fetchStats,
    staleTime: 45_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });
  const { data: coin } = useQuery({
    queryKey: ['coin'],
    queryFn: fetchCoin,
  });
  const { data: blocks } = useQuery({
    queryKey: ['latest-blocks', 50],
    queryFn: () => fetchLatestBlocks(50),
    staleTime: 45_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });
  const { data: masternodesData } = useQuery({
    queryKey: ['masternodes', 'summary', 'rewards-fallback'],
    queryFn: fetchMasternodeSummary,
    staleTime: 45_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });
  const marketQuery = useMarketSnapshot({
    staleTime: 45_000,
    refetchInterval: isPageVisible ? 90_000 : false,
  });
  const stats = statsQuery.data;
  const market = marketQuery.data;
  const loading = statsQuery.isLoading;
  const marketLoading = marketQuery.isLoading;

  // Build chart data from real blocks
  const difficultyHistory = useMemo(
    () => (blocks || []).slice().reverse().map((b) => ({ timestamp: b.time, difficulty: b.difficulty })),
    [blocks]
  );

  // ── Masternode income & ROI calculations (memoized) ─────────────
  const {
    totalBlockReward, effectiveStakingReward, mnRewardPerBlock, supply,
    collateral, onlineMn, totalMn, poseBannedMn,
    hasOnlineMn, dailyIncome,
    roi, paybackDays, avgRewardFreqSec, coinsLockedOnline, coinsLockedOnlinePct,
  } = useMemo(() => {
    const rawBlockReward = stats?.blockReward ?? 0;
    const configuredBaseReward = coin?.INITIAL_REWARD ?? 0;
    const reportedStakingReward = stats?.stakingReward ?? 0;
    const effectiveStakingReward =
      reportedStakingReward > 0
        ? reportedStakingReward
        : configuredBaseReward > 0 && rawBlockReward > configuredBaseReward
          ? rawBlockReward - configuredBaseReward
          : 0;
    const blockRewardBase =
      rawBlockReward > 0 ? Math.max(rawBlockReward - effectiveStakingReward, 0) : configuredBaseReward;
    const collateral = coin?.MASTERNODE_COLLATERAL ?? 0;
    const totalMn = masternodesData?.total ?? 0;
    const onlineMn = masternodesData?.enabled ?? stats?.masternodes ?? totalMn;
    const poseBannedMn = masternodesData?.poseBanned ?? 0;
    const avgBlockTime = Math.max(1, stats?.avgBlockTime || coin?.BLOCK_TIME_SECONDS || 150);
    const blocksPerDay = 86400 / avgBlockTime;
    const mnRewardPerBlock = blockRewardBase;
    const totalBlockReward = rawBlockReward > 0 ? rawBlockReward : blockRewardBase + effectiveStakingReward;

    const dailyMnPool = mnRewardPerBlock * blocksPerDay;
    const hasOnlineMn = onlineMn > 0;
    const dailyIncome = hasOnlineMn ? dailyMnPool / onlineMn : dailyMnPool;
    const yearlyIncome = dailyIncome * 365;

    const roi = collateral > 0 && yearlyIncome > 0 ? (yearlyIncome / collateral) * 100 : 0;
    const paybackDays = dailyIncome > 0 && collateral > 0 ? Math.round(collateral / dailyIncome) : 0;
    const avgRewardFreqSec = onlineMn > 0 ? onlineMn * avgBlockTime : 0;

    const coinsLockedOnline = onlineMn * collateral;
    const supply = stats?.supply?.circulating ?? 0;
    const coinsLockedOnlinePct = supply > 0 && coinsLockedOnline > 0 ? (coinsLockedOnline / supply) * 100 : 0;

    return {
      totalBlockReward, effectiveStakingReward, mnRewardPerBlock, supply,
      collateral, onlineMn, totalMn, poseBannedMn,
      hasOnlineMn, dailyIncome,
      roi, paybackDays, avgRewardFreqSec, coinsLockedOnline, coinsLockedOnlinePct,
    };
  }, [stats, coin, masternodesData]);

  const priceUsd = market?.available ? market?.price?.usd ?? null : null;
  const masternodeValueUsd =
    typeof priceUsd === 'number' && Number.isFinite(priceUsd) && collateral > 0
      ? collateral * priceUsd
      : null;

  const ready = !loading && stats != null && coin != null;
  const displayTotalMn = totalMn > 0 ? totalMn : hasOnlineMn ? onlineMn : 0;
  const [calculatorMnCount, setCalculatorMnCount] = useState(1);

  const calculatorMaxNodes = 100;

  useEffect(() => {
    setCalculatorMnCount((prev) => Math.max(1, Math.min(prev, calculatorMaxNodes)));
  }, [calculatorMaxNodes]);

  const selectedMnCount = Math.max(1, Math.min(calculatorMnCount, calculatorMaxNodes));
  const sliderProgress = calculatorMaxNodes <= 1
    ? 100
    : ((selectedMnCount - 1) / (calculatorMaxNodes - 1)) * 100;
  const sliderStyle = { '--slider-progress': `${sliderProgress}%` } as CSSProperties;

  const calculatorDailyIncome = dailyIncome * selectedMnCount;
  const calculatorWeeklyIncome = calculatorDailyIncome * 7;
  const calculatorMonthlyIncome = calculatorDailyIncome * 30;
  const calculatorYearlyIncome = calculatorDailyIncome * 365;
  const calculatorCollateralNeeded = collateral * selectedMnCount;
  const calculatorUsdValue =
    typeof priceUsd === 'number' && Number.isFinite(priceUsd) && calculatorCollateralNeeded > 0
      ? calculatorCollateralNeeded * priceUsd
      : null;

  const calculatorPresets = useMemo(
    () =>
      Array.from(
        new Set([1, 2, 5, 10, 25, 50, 100, calculatorMaxNodes].filter((value) => value <= calculatorMaxNodes))
      ).sort((a, b) => a - b),
    [calculatorMaxNodes]
  );

  const incomeProjectionCards = [
    { key: 'daily', label: 'Daily Income', amount: calculatorDailyIncome },
    { key: 'weekly', label: 'Weekly Income', amount: calculatorWeeklyIncome },
    { key: 'monthly', label: 'Monthly Income', amount: calculatorMonthlyIncome },
    { key: 'yearly', label: 'Yearly Income', amount: calculatorYearlyIncome },
  ] as const;

  return (
    <div className="fade-in rewards-page">
      <div className="page-header">
        <h1 className="page-title"><HiOutlineCpuChip /> Network Rewards</h1>
        <p className="page-subtitle">Masternode, staking rewards and network performance</p>
      </div>

      {/* ── Top Stats ────────────────────────────────────────────── */}
      <div className="grid-stats rewards-top-stats" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card rewards-kpi rewards-kpi--mn">
          <div className="stat-label"><HiOutlineServerStack /> Online Masternodes</div>
          <div className="stat-value">
            {loading ? '...' : (hasOnlineMn ? formatNumber(onlineMn) : 'N/A')}
          </div>
          {!loading && totalMn > 0 && (
            <div className="rewards-kpi-meta">
              {formatNumber(totalMn)} total ({formatNumber(poseBannedMn)} PoSe banned)
            </div>
          )}
        </div>
        <div className="stat-card rewards-kpi rewards-kpi--wallets">
          <div className="stat-label"><HiOutlineWallet /> Staking Wallets</div>
          <div className="stat-value">
            {loading ? '...' : (stats?.stakingWallets != null ? formatNumber(stats.stakingWallets) : 'N/A')}
          </div>
        </div>
        <div className="stat-card rewards-kpi rewards-kpi--reward">
          <div className="stat-label"><HiOutlineBanknotes /> Block Reward</div>
          <div className="stat-value">
            {loading
              ? '...'
              : `${formatNumber(totalBlockReward)} DFCN`}
          </div>
        </div>
        <div className="stat-card rewards-kpi rewards-kpi--blocktime">
          <div className="stat-label"><HiOutlineClock /> Avg Block Time</div>
          <div className="stat-value">{loading ? '...' : `${stats?.avgBlockTime || 0}s`}</div>
          <div className="rewards-kpi-meta">7-day average</div>
        </div>
      </div>

      {/* ── Masternode Income Estimates ───────────────────────────── */}
      <div className="card rewards-income-panel" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <h2 className="card-title"><HiOutlineCalculator /> Masternode Income Estimates</h2>
        </div>
        <div className="mn-income-tools">
          <div className="mn-income-summary">
            <p className="mn-income-note">
              {hasOnlineMn
                ? `Live projection by selected masternode count (network baseline: ${formatNumber(onlineMn)} online nodes).`
                : 'Live projection by selected masternode count (network baseline is still loading).'}
            </p>
            <div className="mn-income-selected" aria-live="polite">
              <span>Masternodes</span>
              <strong>{formatNumber(selectedMnCount)}</strong>
            </div>
          </div>

          <input
            type="range"
            className="mn-income-slider"
            min={1}
            max={calculatorMaxNodes}
            step={1}
            value={selectedMnCount}
            onChange={(event) => setCalculatorMnCount(Number.parseInt(event.target.value, 10) || 1)}
            aria-label="Masternode count calculator"
            aria-valuemin={1}
            aria-valuemax={calculatorMaxNodes}
            aria-valuenow={selectedMnCount}
            aria-valuetext={`${selectedMnCount} masternodes`}
            style={sliderStyle}
          />
          <div className="mn-income-slider-scale">
            <span>1 MN</span>
            <span>{formatNumber(calculatorMaxNodes)} MN</span>
          </div>

          <div className="mn-income-presets">
            {calculatorPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`mn-income-preset ${preset === selectedMnCount ? 'active' : ''}`}
                onClick={() => setCalculatorMnCount(preset)}
              >
                {formatNumber(preset)}
              </button>
            ))}
          </div>

          <div className="mn-income-metrics">
            <span>
              Collateral need: <strong>{ready ? `${formatNumber(calculatorCollateralNeeded)} DFCN` : '...'}</strong>
            </span>
            <span>
              Portfolio value:{' '}
              <strong>
                {marketLoading
                  ? '...'
                  : calculatorUsdValue != null
                    ? `$${calculatorUsdValue >= 1 ? formatNumber(calculatorUsdValue, 2) : formatSmallPrice(calculatorUsdValue)}`
                    : 'N/A'}
              </strong>
            </span>
          </div>
        </div>
        <div className="grid-stats rewards-income-grid">
          {incomeProjectionCards.map(({ key, label, amount }) => {
            const usdVal = ready && typeof priceUsd === 'number' ? amount * priceUsd : null;
            const dfcnText = ready ? `${formatNumber(amount, 2)} DFCN` : '...';
            const usdText =
              usdVal != null
                ? usdVal >= 1
                  ? `$${formatNumber(usdVal, 2)}`
                  : `$${formatSmallPrice(usdVal)}`
                : null;
            return (
              <div className={`stat-card rewards-income-card rewards-income-card--${key}`} key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value">{usdText ?? dfcnText}</div>
                {usdText !== null && (
                  <div className="rewards-income-dfcn">{dfcnText}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Masternode ROI & Statistics ───────────────────────────── */}
      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <div className="card rewards-detail-card rewards-detail-card--roi">
          <div className="card-header">
            <h2 className="card-title"><HiOutlineChartBarSquare /> Masternode ROI</h2>
          </div>
          <div className="detail-grid">
            <div className="detail-row">
              <div className="detail-label">ROI (annual)</div>
              <div className="detail-value">
                {ready
                  ? roi > 0
                    ? <><span className="value-highlight">{roi.toFixed(2)}%</span> /year</>
                    : 'N/A'
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Payback Period</div>
              <div className="detail-value">
                {ready
                  ? paybackDays > 0
                    ? <>{formatNumber(paybackDays)} days</>
                    : 'N/A'
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">AVG Reward Frequency</div>
              <div className="detail-value">
                {ready
                  ? avgRewardFreqSec > 0
                    ? `Every ${formatDuration(avgRewardFreqSec)}`
                    : 'N/A'
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">MN Reward / Block</div>
              <div className="detail-value">
                {ready ? `${formatNumber(mnRewardPerBlock, 2)} DFCN` : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Staking Bonus / Block</div>
              <div className="detail-value">
                {ready ? `${formatNumber(effectiveStakingReward)} DFCN` : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Masternode Value</div>
              <div className="detail-value">
                {marketLoading
                  ? '...'
                  : typeof masternodeValueUsd === 'number'
                    ? `$${masternodeValueUsd >= 1 ? formatNumber(masternodeValueUsd, 2) : formatSmallPrice(masternodeValueUsd)}`
                    : 'N/A'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Price (USD)</div>
              <div className="detail-value">
                {marketLoading
                  ? '...'
                  : typeof priceUsd === 'number'
                    ? `$${formatSmallPrice(priceUsd)}`
                    : 'N/A'}
              </div>
            </div>
          </div>
        </div>

        <div className="card rewards-detail-card rewards-detail-card--economics">
          <div className="card-header">
            <h2 className="card-title"><HiOutlineLockClosed /> Network Economics</h2>
          </div>
          <div className="detail-grid">
            <div className="detail-row">
              <div className="detail-label">Total Supply</div>
              <div className="detail-value">
                {ready ? `${formatNumber(supply)} DFCN` : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Max Supply</div>
              <div className="detail-value">
                {coin
                  ? coin.MAX_SUPPLY == null
                    ? 'Infinite (inflationary, fixed daily emission)'
                    : `${formatNumber(coin.MAX_SUPPLY)} DFCN`
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Required Collateral</div>
              <div className="detail-value">
                {coin ? `${formatNumber(collateral)} DFCN` : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Coins Locked (Online MN)</div>
              <div className="detail-value">
                {ready
                  ? hasOnlineMn
                    ? `${formatNumber(coinsLockedOnline)} DFCN (${coinsLockedOnlinePct.toFixed(1)}%)`
                    : 'N/A'
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Masternodes (Total)</div>
              <div className="detail-value">
                {ready
                  ? displayTotalMn > 0
                    ? formatNumber(displayTotalMn)
                    : 'N/A'
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Masternodes (Online)</div>
              <div className="detail-value">
                {ready
                  ? hasOnlineMn
                    ? formatNumber(onlineMn)
                    : 'N/A'
                  : '...'}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label">Masternodes (PoSe Banned)</div>
              <div className="detail-value">
                {ready ? formatNumber(poseBannedMn) : '...'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Charts ───────────────────────────────────────────────── */}
      <div className="card rewards-activity-card">
          <div className="card-header">
            <h2 className="card-title"><HiOutlineArrowTrendingUp /> Network Activity</h2>
          </div>
          {difficultyHistory.length > 1 ? (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={difficultyHistory}>
                <defs>
                  <linearGradient id="diffGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(t) => new Date(t * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatDifficulty(v)}
                  stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={65}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
                  labelFormatter={(t) => new Date(t * 1000).toLocaleDateString()}
                  formatter={(v: number) => [formatDifficulty(v), 'Difficulty']}
                />
                <Area
                  type="monotone"
                  dataKey="difficulty"
                  stroke={chartColor}
                  strokeWidth={2}
                  fill="url(#diffGrad)"
                  {...chartAnimation}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Syncing data...</div>
          )}
      </div>

    </div>
  );
}
