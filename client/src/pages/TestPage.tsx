import { useMemo } from 'react';
import { HiOutlineBeaker, HiOutlineChartBar, HiOutlineCpuChip, HiOutlineServerStack } from 'react-icons/hi2';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_ANIMATION } from '../utils/chartAnimation';
import './PageStyles.css';
import './TestPage.css';

type TelemetryPoint = {
  label: string;
  gpuUtilization: number;
  gpuVramUsed: number;
  hddRead: number;
  hddWrite: number;
  ramUtilization: number;
};

function randomValue(min: number, max: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round((min + Math.random() * (max - min)) * factor) / factor;
}

function buildMockTelemetrySeries(): TelemetryPoint[] {
  return Array.from({ length: 12 }, (_, index) => {
    const minuteMark = (index + 1) * 5;
    const label = minuteMark === 60 ? 'now' : `-${60 - minuteMark}m`;

    return {
      label,
      gpuUtilization: randomValue(32, 94, 0),
      gpuVramUsed: randomValue(5.4, 17.6, 1),
      hddRead: randomValue(90, 860, 0),
      hddWrite: randomValue(40, 520, 0),
      ramUtilization: randomValue(38, 88, 0),
    };
  });
}

export default function TestPage() {
  const telemetry = useMemo(() => buildMockTelemetrySeries(), []);
  const latest = telemetry[telemetry.length - 1];

  return (
    <div className="fade-in">
      <div className="page-header">
        <h1 className="page-title">
          <HiOutlineBeaker /> Test Lab
        </h1>
        <p className="page-subtitle">Mock telemetry dashboard (GPU, VRAM, HDD, RAM/CPU) for future live PoR metrics.</p>
      </div>

      <div className="card test-disclaimer">
        <div className="test-disclaimer-head">
          <span className="badge warning">Warning</span>
          <strong>Development-only mock data</strong>
        </div>
        <p>
          The charts below show synthetic values for UI testing only. They are not valid on-chain or node telemetry
          measurements and must not be used for operational decisions.
        </p>
        <p className="test-disclaimer-foot">
          Planned next step: replace this mock feed with real metrics from node agents (GPU, HDD, RAM, CPU).
        </p>
      </div>

      <div className="test-grid">
        <div className="card test-chart-card">
          <div className="card-header">
            <h2 className="card-title">
              <HiOutlineCpuChip /> GPU Utilization
            </h2>
            <span className="badge">Mock</span>
          </div>
          <p className="test-chart-meta">Latest: {latest?.gpuUtilization ?? 0}%</p>
          <div className="test-chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={telemetry}>
                <defs>
                  <linearGradient id="gpuUtilGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-line)" stopOpacity={0.33} />
                    <stop offset="95%" stopColor="var(--chart-line)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                  }}
                  formatter={(value: number) => [`${value}%`, 'GPU']}
                />
                <Area
                  type="monotone"
                  dataKey="gpuUtilization"
                  stroke="var(--chart-line)"
                  strokeWidth={2}
                  fill="url(#gpuUtilGrad)"
                  {...CHART_ANIMATION}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card test-chart-card">
          <div className="card-header">
            <h2 className="card-title">
              <HiOutlineChartBar /> GPU VRAM Usage
            </h2>
            <span className="badge">Mock</span>
          </div>
          <p className="test-chart-meta">Latest: {latest?.gpuVramUsed ?? 0} GB</p>
          <div className="test-chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={telemetry}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, 24]}
                  tickFormatter={(v) => `${v} GB`}
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={55}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                  }}
                  formatter={(value: number) => [`${value} GB`, 'VRAM']}
                />
                <Line
                  type="monotone"
                  dataKey="gpuVramUsed"
                  stroke="var(--accent-secondary)"
                  strokeWidth={2.5}
                  dot={false}
                  {...CHART_ANIMATION}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card test-chart-card">
          <div className="card-header">
            <h2 className="card-title">
              <HiOutlineServerStack /> HDD I/O Throughput
            </h2>
            <span className="badge">Mock</span>
          </div>
          <p className="test-chart-meta">
            Latest: R {latest?.hddRead ?? 0} MB/s | W {latest?.hddWrite ?? 0} MB/s
          </p>
          <div className="test-chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={telemetry}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  tickFormatter={(v) => `${v}`}
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                  }}
                  formatter={(value: number, name: string) => [`${value} MB/s`, name]}
                />
                <Bar
                  dataKey="hddRead"
                  name="Read"
                  fill="var(--chart-line)"
                  radius={[4, 4, 0, 0]}
                  opacity={0.88}
                  {...CHART_ANIMATION}
                />
                <Bar
                  dataKey="hddWrite"
                  name="Write"
                  fill="var(--accent-secondary)"
                  radius={[4, 4, 0, 0]}
                  opacity={0.88}
                  {...CHART_ANIMATION}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card test-chart-card">
          <div className="card-header">
            <h2 className="card-title">
              <HiOutlineCpuChip /> RAM Usage
            </h2>
            <span className="badge">Mock</span>
          </div>
          <p className="test-chart-meta">Latest: RAM {latest?.ramUtilization ?? 0}%</p>
          <div className="test-chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={telemetry}>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}`}
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="ramUtilization"
                  name="RAM %"
                  stroke="var(--chart-line)"
                  strokeWidth={2.2}
                  dot={false}
                  {...CHART_ANIMATION}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
