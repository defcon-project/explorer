// Data for the home page's Live Flow chart. Kept free of the chart library, so the page can
// build its legend and table without loading Recharts; the chart itself is a lazy chunk.

import { formatNumber } from '../../utils/formatters';

const HOUR_MS = 3_600_000;

export interface FlowPointInput {
  hour: string;
  blocks: number;
  txs: number;
}

export interface FlowChartPoint {
  /** The server's bucket key, "2026-09-05T12:00:00Z". */
  hour: string;
  startMs: number;
  /** A count the server did not send as a non-negative number is null (unknown), not 0. */
  blocks: number | null;
  txs: number | null;
  /** The newest bucket while its hour has not ended: it is still filling up. */
  inProgress: boolean;
}

/** The server buckets flow by UTC hour, so the hour is shown in UTC too, not in the browser's time zone. */
export function formatUtcHour(ms: number): string {
  return `${String(new Date(ms).getUTCHours()).padStart(2, '0')}:00`;
}

/** "12:00–13:00", the span of one hourly bucket. */
export function formatUtcHourSpan(startMs: number): string {
  return `${formatUtcHour(startMs)}–${formatUtcHour(startMs + HOUR_MS)}`;
}

// ── x axis ────────────────────────────────────────────────────────────────────

const TICK_STEPS = [1, 2, 3, 4, 6, 8, 12];
const MIN_TICK_SPACING_PX = 44; // an "HH:00" label at 11 px plus air

/** Every how many hours the x axis is labelled, so the labels never crowd in a plot this wide. */
export function flowTickStep(plotWidthPx: number, pointCount: number): number {
  const slot = plotWidthPx / Math.max(pointCount, 1);
  return TICK_STEPS.find((step) => slot * step >= MIN_TICK_SPACING_PX) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

/** Evenly spaced hour labels that always include the newest hour. */
export function flowTicks(points: readonly FlowChartPoint[], step: number): number[] {
  const last = points.length - 1;
  return points.filter((_, index) => (last - index) % step === 0).map((point) => point.startMs);
}

// ── y axis ────────────────────────────────────────────────────────────────────

export interface FlowYAxis {
  ticks: number[];
  top: number;
  /** One label style per axis: compact ("10K") once the axis reaches 10,000, in full below. */
  compact: boolean;
}

const COMPACT_FROM = 10_000;

/** The smallest of 1, 2, 2.5, 5 × 10^n that is at least `raw`, and a whole number. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    const step = multiple * power;
    if (step >= raw && Number.isInteger(step)) return step;
  }
  return 10 * power;
}

/** Round ticks from 0 to just above the largest count, about four intervals. */
export function flowYAxis(points: readonly FlowChartPoint[]): FlowYAxis {
  const max = Math.max(0, ...points.flatMap((point) => [point.blocks ?? 0, point.txs ?? 0]));
  const step = niceStep(max / 4);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { ticks, top, compact: top >= COMPACT_FROM };
}

function trimDecimals(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function formatAxisCount(value: number, compact: boolean): string {
  if (!compact || value < 1_000) return formatNumber(value);
  if (value < 1_000_000) return `${trimDecimals(value / 1_000)}K`;
  return `${trimDecimals(value / 1_000_000)}M`;
}

// Recharts right-aligns a y label about 8 px left of the axis line; an 11 px digit is under 7 px wide.
const Y_LABEL_CHAR_PX = 7;
const Y_LABEL_OFFSET_PX = 12;
const Y_AXIS_MIN_PX = 28;

/** Wide enough for the longest label, so no label is cut at the chart's left edge. */
export function flowYAxisWidth(labels: readonly string[]): number {
  const longest = Math.max(0, ...labels.map((label) => label.length));
  return Math.max(Y_AXIS_MIN_PX, longest * Y_LABEL_CHAR_PX + Y_LABEL_OFFSET_PX);
}

// ── points ────────────────────────────────────────────────────────────────────

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Oldest first; points whose hour cannot be read are left out. Only the newest bucket can be in
 * progress (the server's last bucket is the hour its clock was in), and only until that hour ends
 * by this browser's clock: a slow browser clock still marks the newest hour, and a page left open
 * past the hour stops marking it.
 */
export function buildFlowChartPoints(points: readonly FlowPointInput[], nowMs: number): FlowChartPoint[] {
  const sorted = points
    .map((point) => ({ point, startMs: Date.parse(point.hour) }))
    .filter(({ startMs }) => Number.isFinite(startMs))
    .sort((a, b) => a.startMs - b.startMs);
  const last = sorted.length - 1;
  return sorted.map(({ point, startMs }, index) => ({
    hour: point.hour,
    startMs,
    blocks: count(point.blocks),
    txs: count(point.txs),
    inProgress: index === last && nowMs < startMs + HOUR_MS,
  }));
}
