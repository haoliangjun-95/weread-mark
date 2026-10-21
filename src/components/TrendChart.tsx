import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

/** 趋势卡片用到的 recharts 图表本体（懒加载分包） */
export default function TrendChart({ chartData }: { chartData: Array<{ date: string; 笔记总数: number; 读完: number }> }) {
  const tooltipStyle = {
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--tooltip-bg)',
    color: 'var(--text-primary)',
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: -18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="笔记总数"
          stroke="var(--chart-bar)"
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="读完"
          stroke="var(--chart-line)"
          strokeWidth={2}
          dot={{ r: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
