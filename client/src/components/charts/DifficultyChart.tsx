import { useId } from 'react';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatDifficulty } from '../../utils/formatters';
import { useChartAnimation } from '../../utils/chartAnimation';

interface DifficultyPoint {
  timestamp: number;
  difficulty: number;
}

interface DifficultyChartProps {
  data: DifficultyPoint[];
}

export default function DifficultyChart({ data }: DifficultyChartProps) {
  const gradientId = useId();
  const chartAnimation = useChartAnimation();

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-line)" stopOpacity={0.34} />
            <stop offset="95%" stopColor="var(--chart-line)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <XAxis
          dataKey="timestamp"
          tickFormatter={(t) =>
            new Date(t * 1000).toLocaleDateString('en', { month: 'short', day: 'numeric' })
          }
          stroke="var(--text-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />

        <YAxis
          tickFormatter={(v) => formatDifficulty(v)}
          stroke="var(--text-muted)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={86}
        />

        <Tooltip
          contentStyle={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            fontSize: '0.84rem',
          }}
          labelFormatter={(t) => new Date((t as number) * 1000).toLocaleString()}
          formatter={(v: number) => [formatDifficulty(v), 'Difficulty']}
        />

        <Area
          type="monotone"
          dataKey="difficulty"
          stroke="var(--chart-line)"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          {...chartAnimation}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
