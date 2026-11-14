import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatNumber } from '../../utils/formatters';
import {
  flowTickStep,
  flowTicks,
  flowYAxis,
  flowYAxisWidth,
  formatAxisCount,
  formatUtcHour,
  formatUtcHourSpan,
  type FlowChartPoint,
} from './liveFlowModel';

// Loaded lazily by the home page, so Recharts stays out of its first load.
// Blocks and transactions are both counts per hour, so they share one y axis and their bars
// compare directly. The hour that is still filling up is drawn lighter and named in the tooltip.
// No Recharts accessibilityLayer: it makes the chart focusable, and on focus (a tap on a phone)
// it moves the tooltip to the first hour. Keyboard and screen-reader users get the page's table.

// Lighter than a finished hour, still 3:1 against the card for both series.
const CURRENT_HOUR_OPACITY = 0.6;
const RIGHT_MARGIN_PX = 16;

interface FlowTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: FlowChartPoint }>;
}

function formatCount(value: number | null): string {
  return value == null ? 'n/a' : formatNumber(value);
}

function FlowTooltip({ active, payload }: FlowTooltipProps) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="flow-tooltip">
      <div className="flow-tooltip-title">
        {formatUtcHourSpan(point.startMs)} UTC
        {point.inProgress ? <span className="flow-tooltip-note"> · in progress</span> : null}
      </div>
      <div className="flow-tooltip-row">
        <i className="flow-key flow-key-blocks" aria-hidden="true" />
        <strong>{formatCount(point.blocks)}</strong>
        <span>blocks</span>
      </div>
      <div className="flow-tooltip-row">
        <i className="flow-key flow-key-txs" aria-hidden="true" />
        <strong>{formatCount(point.txs)}</strong>
        <span>transactions</span>
      </div>
    </div>
  );
}

const axisTick = { fill: 'var(--text-muted)', fontSize: 11 };

export default function LiveFlowChart({ points }: { points: FlowChartPoint[] }) {
  const [width, setWidth] = useState(0);
  const yAxis = useMemo(() => flowYAxis(points), [points]);
  const yLabel = (value: number) => formatAxisCount(value, yAxis.compact);
  const yWidth = flowYAxisWidth(yAxis.ticks.map(yLabel));
  const ticks = flowTicks(points, flowTickStep(width - yWidth - RIGHT_MARGIN_PX, points.length));
  return (
    <div
      className="flow-chart"
      role="img"
      aria-label="Blocks and transactions per UTC hour, last 24 hours. The numbers are in the Hourly numbers table below."
    >
      <ResponsiveContainer width="100%" height="100%" onResize={(nextWidth) => setWidth(nextWidth)}>
        <BarChart
          data={points}
          barGap={2}
          barCategoryGap="20%"
          // The right margin leaves room for the newest hour's label, centred under the last bars.
          margin={{ top: 8, right: RIGHT_MARGIN_PX, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="startMs"
            tickFormatter={(value: number) => formatUtcHour(value)}
            ticks={ticks}
            interval={0}
            tickLine={false}
            axisLine={{ stroke: 'var(--chart-grid)' }}
            tick={axisTick}
          />
          <YAxis
            domain={[0, yAxis.top]}
            ticks={yAxis.ticks}
            interval={0}
            tickFormatter={yLabel}
            width={yWidth}
            tickLine={false}
            axisLine={false}
            tick={axisTick}
          />
          <Tooltip
            content={<FlowTooltip />}
            cursor={{ fill: 'var(--accent-soft)' }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="blocks"
            name="Blocks"
            fill="var(--chart-series-1)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {points.map((point) => (
              <Cell key={point.hour} fillOpacity={point.inProgress ? CURRENT_HOUR_OPACITY : 1} />
            ))}
          </Bar>
          <Bar
            dataKey="txs"
            name="Transactions"
            fill="var(--chart-series-2)"
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          >
            {points.map((point) => (
              <Cell key={point.hour} fillOpacity={point.inProgress ? CURRENT_HOUR_OPACITY : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
