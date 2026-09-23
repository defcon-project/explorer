import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HiOutlineFire,
  HiOutlineBolt,
  HiOutlineGlobeAlt,
  HiOutlineExclamationTriangle,
  HiOutlineArrowPath,
  HiOutlineClock,
} from 'react-icons/hi2';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceArea,
} from 'recharts';
import { fetchBanWaveAnalysis } from '../services/api';
import { useChartAnimation } from '../utils/chartAnimation';
import { formatNumber, truncateHash } from '../utils/formatters';
import type { BanWaveAnalysisView, BanWaveDetail } from '../types/api';
import { usePageVisibility } from '../hooks/usePageVisibility';
import './PageStyles.css';
import './MasternodeHealthPage.css';
import './BanDetectionPage.css';

type WindowKey = '24h' | '7d' | '30d' | '90d';
type TimelineMode = 'fresh' | 'recovered' | 'still' | 'all';

const WINDOW_OPTIONS: { key: WindowKey; label: string; hours: number }[] = [
  { key: '24h', label: '24h', hours: 24 },
  { key: '7d', label: '7 days', hours: 168 },
  { key: '30d', label: '30 days', hours: 720 },
  { key: '90d', label: '90 days', hours: 2160 },
];


const SEVERITY_COLOR: Record<BanWaveDetail['severity'], string> = {
  low: '#888',
  moderate: '#f5a623',
  high: '#ef4d56',
  critical: '#9b1b22',
};

const SEVERITY_RANK: Record<BanWaveDetail['severity'], number> = {
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_BAND_OPACITY: Record<BanWaveDetail['severity'], number> = {
  low: 0.03,
  moderate: 0.05,
  high: 0.07,
  critical: 0.1,
};

function severityClass(s: BanWaveDetail['severity']): string {
  return `bd-sev bd-sev-${s}`;
}

function bucketToTimestampMs(bucket: string): number {
  const direct = new Date(bucket).getTime();
  if (Number.isFinite(direct)) return direct;
  const asDay = new Date(`${bucket}T00:00:00Z`).getTime();
  if (Number.isFinite(asDay)) return asDay;
  return 0;
}

function formatBucket(bucket: string, mode: 'hour' | 'day' | '15min' | 'auto'): string {
  if (mode === 'day' || bucket.length === 10) return bucket.slice(5);
  const d = new Date(bucket);
  if (mode === '15min') {
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}h`;
}

function humanDuration(sec: number | null): string {
  if (sec == null) return '-';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round((sec / 3600) * 10) / 10}h`;
  return `${Math.round((sec / 86400) * 10) / 10}d`;
}

function timelineModeDescription(mode: TimelineMode): string {
  if (mode === 'fresh') return 'Actual new PoSe bans in the last 24h by PoSeBanHeight block time';
  if (mode === 'recovered') return 'Recovery events for previously detected drops; historical bans remain visible';
  if (mode === 'still') return 'Historical drop events whose nodes are still currently POSE_BANNED';
  return 'All historical drop events plus recovery markers; not just current state';
}

function waveNodeStatusLabel(status?: string): string {
  if (status === 'recovered') return 'RECOVERED';
  if (status === 'still_banned') return 'STILL BANNED';
  return 'BANNED';
}

export function BanDetectionPage() {
  const [windowKey, setWindowKey] = useState<WindowKey>('30d');
  const windowMinutes = 30;
  const minNodes = 3;
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('fresh');
  const [paused, setPaused] = useState<boolean>(false);
  const isPageVisible = usePageVisibility();
  const chartAnimation = useChartAnimation();

  const win = WINDOW_OPTIONS.find((w) => w.key === windowKey) ?? WINDOW_OPTIONS[1];

  const { data, isLoading, isFetching, refetch } = useQuery<BanWaveAnalysisView>({
    queryKey: ['ban-waves', win.hours, windowMinutes, minNodes],
    queryFn: () => fetchBanWaveAnalysis({ hours: win.hours, windowMinutes, minNodes }),
    refetchInterval: paused || !isPageVisible ? false : 90_000,
    staleTime: 45_000,
  });

  const timelineChartData = useMemo(() => {
    if (!data) return [];
    const timeline = data.timelineModes?.[timelineMode] ?? data.timeline;
    if (timeline.length === 0) return [];
    const firstActive = timeline.findIndex((point) => point.waveBans > 0 || point.isolatedBans > 0 || (point.recovered ?? 0) > 0 || (point.stillBanned ?? 0) > 0);
    if (firstActive < 0) return timeline;

    let lastActive = timeline.length - 1;
    while (lastActive >= 0) {
      const point = timeline[lastActive];
      if (point.waveBans > 0 || point.isolatedBans > 0 || (point.recovered ?? 0) > 0 || (point.stillBanned ?? 0) > 0) break;
      lastActive -= 1;
    }

    const padding = Math.min(8, Math.max(2, Math.round(timeline.length * 0.08)));
    const start = Math.max(0, firstActive - padding);
    const end = Math.min(timeline.length - 1, lastActive + padding);
    return timeline.slice(start, end + 1);
  }, [data, timelineMode]);

  const waveBands = useMemo(() => {
    if (!data || timelineChartData.length === 0) return [] as Array<{
      x1: string;
      x2: string;
      severity: BanWaveDetail['severity'];
      opacity: number;
    }>;

    if (Array.isArray(data.waveBands) && data.waveBands.length > 0) {
      const timelineSet = new Set(timelineChartData.map((point) => point.bucket));
      return data.waveBands
        .filter((band) => timelineSet.has(band.x1) || timelineSet.has(band.x2))
        .map((band) => ({
          x1: band.x1,
          x2: band.x2,
          severity: band.severity,
          opacity: SEVERITY_BAND_OPACITY[band.severity],
        }));
    }

    const bucketTimes = timelineChartData.map((point) => bucketToTimestampMs(point.bucket));
    const intervals: Array<{ start: number; end: number; severity: BanWaveDetail['severity'] }> = [];

    for (const wave of data.waves) {
      const startMs = new Date(wave.startedAt).getTime();
      const endMs = new Date(wave.endedAt).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      if (endMs < bucketTimes[0] || startMs > bucketTimes[bucketTimes.length - 1]) continue;

      let startIdx = 0;
      for (let i = bucketTimes.length - 1; i >= 0; i -= 1) {
        if (bucketTimes[i] <= startMs) {
          startIdx = i;
          break;
        }
      }

      let endIdx = bucketTimes.length - 1;
      for (let i = 0; i < bucketTimes.length; i += 1) {
        if (bucketTimes[i] >= endMs) {
          endIdx = i;
          break;
        }
      }

      if (endIdx < startIdx) continue;
      intervals.push({ start: startIdx, end: endIdx, severity: wave.severity });
    }

    if (intervals.length === 0) return [];
    intervals.sort((a, b) => a.start - b.start);

    const merged: Array<{ start: number; end: number; severity: BanWaveDetail['severity'] }> = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (!last || interval.start > last.end + 1) {
        merged.push({ ...interval });
        continue;
      }
      last.end = Math.max(last.end, interval.end);
      if (SEVERITY_RANK[interval.severity] > SEVERITY_RANK[last.severity]) {
        last.severity = interval.severity;
      }
    }

    return merged.map((band) => ({
      x1: timelineChartData[band.start]?.bucket ?? timelineChartData[0].bucket,
      x2: timelineChartData[band.end]?.bucket ?? timelineChartData[timelineChartData.length - 1].bucket,
      severity: band.severity,
      opacity: SEVERITY_BAND_OPACITY[band.severity],
    }));
  }, [data, timelineChartData]);

  const timelineFocused = Boolean(data && timelineChartData.length > 0 && timelineChartData.length < data.timeline.length);

  return (
    <div className="page-container">
      <section className="bd-hero-card">
        <header className="bd-hero-header">
          <div className="bd-hero-copy">
            <div className="bd-hero-kicker">Monitoring</div>
          <h1 className="page-title">
            <HiOutlineFire style={{ verticalAlign: '-0.15em', marginRight: '0.4rem' }} />
            Ban Detection
          </h1>
          <p className="page-subtitle">
            Coordinated PoSe ban events on the DeFCoN masternode network - detect mass-ban
            waves, geographic concentration and severity over time.
          </p>
        </div>
        <div className="bd-header-controls">
          <div className="bd-chip-group bd-chip-group-range" role="tablist" aria-label="Time window">
            {WINDOW_OPTIONS.map((w) => (
              <button
                key={w.key}
                role="tab"
                aria-selected={windowKey === w.key}
                className={`bd-chip-btn ${windowKey === w.key ? 'active' : ''}`}
                onClick={() => setWindowKey(w.key)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div className="bd-header-actions">
            <button
              type="button"
              className="bd-icon-btn"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh now"
            >
              <HiOutlineArrowPath className={isFetching ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              className={`bd-icon-btn ${paused ? 'active' : ''}`}
              onClick={() => setPaused((p) => !p)}
              title={paused ? 'Auto-refresh paused' : 'Pause auto-refresh'}
            >
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
          </div>
        </div>
        </header>
      </section>

      {/* KPI strip */}
      <section className="mnh-stats-grid">
        <KPI
          icon={<HiOutlineBolt />}
          label="Fresh drops 24h"
          value={data ? formatNumber(data.freshDrops24h ?? data.kpis.freshDrops24h ?? data.eventBreakdown?.uniqueFreshNodes ?? 0) : '-'}
          sub="Actual new PoSe bans in the last 24h"
        />
        <KPI
          icon={<HiOutlineFire />}
          label="Detected waves 24h"
          value={data ? formatNumber(data.kpis.waveCount) : '-'}
          sub={`fresh drops >=${minNodes} nodes / ${windowMinutes}m`}
        />
        <KPI
          icon={<HiOutlineExclamationTriangle />}
          label="Largest wave 24h"
          value={data ? `${data.kpis.largestWave} nodes` : '-'}
          sub={data ? `${formatNumber(data.kpis.nodesInWaves)} fresh drops in waves` : ''}
        />
        <KPI
          icon={<HiOutlineGlobeAlt />}
          label="Countries hit"
          value={data ? formatNumber(data.kpis.uniqueCountries) : '-'}
          sub={`${data ? formatNumber(data.eventBreakdown?.uniqueFreshNodes ?? data.kpis.uniqueBannedNodes) : '-'} unique fresh nodes`}
        />
        <KPI
          icon={<HiOutlineClock />}
          label="Avg gap between waves"
          value={data ? humanDuration(data.kpis.meanTimeBetweenWavesSec) : '-'}
          sub="Lower = more clustered"
        />
      </section>

      {/* Timeline ComposedChart */}
      <section className="mnh-panel">
        <div className="mnh-panel-header">
          <h2 className="mnh-panel-title">
            <HiOutlineClock /> Drop event history
          </h2>
          <div className="bd-timeline-toolbar">
            <span className="mnh-panel-sub">
              {timelineModeDescription(timelineMode)}
              {timelineFocused ? ' - focused on active interval' : ''}
            </span>
            <div className="bd-chip-group" role="tablist" aria-label="Timeline mode">
              <button
                type="button"
                role="tab"
                aria-selected={timelineMode === 'fresh'}
                className={`bd-chip-btn ${timelineMode === 'fresh' ? 'active' : ''}`}
                onClick={() => setTimelineMode('fresh')}
              >
                Fresh drops
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={timelineMode === 'recovered'}
                className={`bd-chip-btn ${timelineMode === 'recovered' ? 'active' : ''}`}
                onClick={() => setTimelineMode('recovered')}
              >
                Recovered
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={timelineMode === 'still'}
                className={`bd-chip-btn ${timelineMode === 'still' ? 'active' : ''}`}
                onClick={() => setTimelineMode('still')}
              >
                Still banned
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={timelineMode === 'all'}
                className={`bd-chip-btn ${timelineMode === 'all' ? 'active' : ''}`}
                onClick={() => setTimelineMode('all')}
              >
                All tracked
              </button>
            </div>
          </div>
        </div>
        {data?.eventBreakdown && (
          <div className="bd-event-breakdown">
            <span title="Actual new PoSe bans in the last 24h by PoSeBanHeight block time.">
              Fresh 24h: {formatNumber(data.freshDrops24h ?? data.kpis.freshDrops24h ?? data.eventBreakdown.freshBans)}
            </span>
            <span title="Current registered masternodes with PoSeBanHeight != -1.">
              Current POSE_BANNED: {formatNumber(data.currentPoseBanned ?? data.kpis.currentPoseBanned ?? 0)}
            </span>
            <span title="Current registered masternodes receiving PoSe penalty points but not banned.">
              Current POSE_PENALTY: {formatNumber(data.currentPosePenalty ?? data.kpis.currentPosePenalty ?? 0)}
            </span>
            <span title="Current valid masternodes: ENABLED plus POSE_PENALTY.">
              Valid MNs: {formatNumber(data.currentValid ?? data.kpis.currentValid ?? 0)}
            </span>
            <span title="Total registered masternodes in the live snapshot.">
              Registered MNs: {formatNumber(data.registeredTotal ?? data.kpis.registeredTotal ?? 0)}
            </span>
          </div>
        )}
        <div style={{ width: '100%', height: 360 }}>
          {data && timelineChartData.length > 0 && (
            <ResponsiveContainer>
              <ComposedChart data={timelineChartData} margin={{ top: 8, right: 8, bottom: 8, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.4} />
                <XAxis
                  dataKey="bucket"
                  stroke="var(--text-color-muted)"
                  tickFormatter={(b) => formatBucket(String(b), data.bucket)}
                  fontSize={11}
                  minTickGap={24}
                />
                <YAxis
                  yAxisId="left"
                  stroke="var(--text-color-muted)"
                  fontSize={11}
                  allowDecimals={false}
                  width={34}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="var(--text-color-muted)"
                  fontSize={11}
                  allowDecimals={false}
                  width={34}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: 'var(--text-color)',
                  }}
                  labelStyle={{ color: 'var(--text-color)' }}
                  itemStyle={{ color: 'var(--text-color)' }}
                  labelFormatter={(b) => formatBucket(String(b), data.bucket)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {waveBands.map((band, idx) => (
                  <ReferenceArea
                    key={`${band.x1}-${band.x2}-${idx}`}
                    yAxisId="left"
                    x1={band.x1}
                    x2={band.x2}
                    fill={SEVERITY_COLOR[band.severity]}
                    fillOpacity={band.opacity}
                  />
                ))}
                {timelineMode === 'recovered' ? (
                  <Bar
                    yAxisId="left"
                    dataKey="recovered"
                    fill="var(--success)"
                    name="Recovery events"
                    maxBarSize={22}
                    {...chartAnimation}
                  />
                ) : timelineMode === 'still' ? (
                  <Bar
                    yAxisId="left"
                    dataKey="stillBanned"
                    fill="#ef4d56"
                    name="Still banned drop events"
                    maxBarSize={22}
                    {...chartAnimation}
                  />
                ) : (
                  <>
                    <Bar
                      yAxisId="left"
                      dataKey="isolatedBans"
                      stackId="bans"
                      fill="#888"
                      name="Isolated drop events"
                      maxBarSize={22}
                      {...chartAnimation}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="waveBans"
                      stackId="bans"
                      fill="#ef4d56"
                      name="Wave drop events"
                      maxBarSize={22}
                      {...chartAnimation}
                    />
                    {timelineMode === 'all' && (
                      <Bar
                        yAxisId="left"
                        dataKey="recovered"
                        fill="var(--success)"
                        name="Recovery events"
                        maxBarSize={22}
                        {...chartAnimation}
                      />
                    )}
                  </>
                )}
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#2f8fff"
                  strokeWidth={2}
                  dot={false}
                  name={timelineMode === 'recovered' ? 'Cumulative recovery events' : 'Cumulative drop events'}
                  {...chartAnimation}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Wave list */}
      <section className="mnh-panel">
        <div className="mnh-panel-header">
          <h2 className="mnh-panel-title">
            <HiOutlineFire /> Detected Waves ({data?.waves.length ?? 0})
          </h2>
          <span className="mnh-panel-sub">
            Newest first | severity score = nodes x IP/operator concentration x speed
          </span>
        </div>

        {(!data || data.waves.length === 0) && (
          <div className="mnh-empty" style={{ padding: '2rem' }}>
            {isLoading
              ? 'Loading...'
              : 'No wave matched the current thresholds. Try lowering "Min nodes" or widening the wave window.'}
          </div>
        )}

        {data?.waves.map((w) => (
          <WaveCard key={w.id} wave={w} />
        ))}
      </section>
    </div>
  );
}

function KPI({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="mnh-stat-card">
      <div className="mnh-stat-icon">{icon}</div>
      <div className="mnh-stat-body">
        <div className="mnh-stat-label">{label}</div>
        <div className="mnh-stat-value">{value}</div>
        {sub && <div className="mnh-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function WaveCard({ wave }: { wave: BanWaveDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bd-wave-card">
      <button
        type="button"
        className="bd-wave-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={severityClass(wave.severity)}>{wave.severity}</span>
        <span className="bd-wave-title">
          {wave.totalNodes} nodes | {wave.stillBannedCount ?? 0} still banned | {wave.recoveredCount ?? 0} recovered | {humanDuration(wave.durationSeconds)}
        </span>
        <span className="bd-wave-meta">
          {new Date(wave.startedAt).toLocaleString()} |{' '}
          {wave.uniqueCountries} countr{wave.uniqueCountries === 1 ? 'y' : 'ies'} |{' '}
          {wave.uniqueIps} IP{wave.uniqueIps === 1 ? '' : 's'} |{' '}
          {wave.uniqueOperators} operator{wave.uniqueOperators === 1 ? '' : 's'} | versions: {(wave.versions || []).slice(0, 3).join(', ') || 'not observed'}
        </span>
        <span className="bd-wave-score">score {wave.severityScore}</span>
        <span className="bd-wave-toggle">{open ? '-' : '+'}</span>
      </button>
      {open && (
        <div className="bd-wave-body">
          <div className="bd-wave-tags">
            {wave.countries.map((c) => (
              <span key={c} className="bd-country-tag">
                {c}
              </span>
            ))}
          </div>
          <div className="mnh-table-wrap">
            <table className="mnh-table">
              <thead>
                <tr>
                  <th>Detected</th>
                  <th>Recovered</th>
                  <th>Status</th>
                  <th>Node</th>
                  <th>Transition</th>
                  <th>IP / Service</th>
                  <th>Wallet version</th>
                  <th>Country</th>
                  <th>Operator</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {wave.nodes.map((n) => (
                  <tr key={n.nodeId + n.atIso}>
                    <td className="mnh-mono" title={n.detectedAt || n.atIso}>
                      {new Date(n.detectedAt || n.atIso).toLocaleString()}
                    </td>
                    <td className="mnh-mono" title={n.recoveredAt || undefined}>
                      {n.recoveredAt ? new Date(n.recoveredAt).toLocaleString() : 'not recovered yet'}
                    </td>
                    <td>
                      <span className={`bd-status-badge bd-status-${n.status || 'banned'}`}>
                        {waveNodeStatusLabel(n.status)}
                      </span>
                    </td>
                    <td className="mnh-mono" title={n.nodeId}>
                      {truncateHash(n.proTxHash || n.nodeId, 6)}
                    </td>
                    <td>
                      <span className="badge">{n.recoveryTransition || `${n.previousStatus || 'POSE_BAN_HEIGHT'} -> POSE_BANNED`}</span>
                    </td>
                    <td className="mnh-mono">{n.service || n.ip || '-'}</td>
                    <td>
                      <span className="badge badge-accent">
                        {n.walletVersion || (typeof n.protocolVersion === 'number' ? `protocol ${n.protocolVersion}` : 'not observed')}
                      </span>
                      {n.versionObservedAt && (
                        <div className="mnh-meta-line">seen {new Date(n.versionObservedAt).toLocaleString()}</div>
                      )}
                    </td>
                    <td>
                      {n.countryCode !== 'UNK' ? n.countryCode : '-'}
                      <div className="mnh-meta-line">{n.countryName}</div>
                    </td>
                    <td className="mnh-mono">
                      {n.operatorPubkey ? truncateHash(n.operatorPubkey, 6) : '-'}
                    </td>
                    <td>
                      {n.payoutAddress ? (
                        <Link className="mnh-link mnh-mono" to={`/address/${n.payoutAddress}`}>
                          {truncateHash(n.payoutAddress, 6)}
                        </Link>
                      ) : (
                        <span className="mnh-meta-line">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default BanDetectionPage;
