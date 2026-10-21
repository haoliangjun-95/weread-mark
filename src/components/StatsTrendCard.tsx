import { useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { queryStatsSnapshots, isNativeApp } from '../services/localDb';
import type { StatsSnapshotRow } from '../services/localDb';
import { onLocalReady } from '../services/dataService';

/**
 * 阅读趋势卡片：消费每次同步累积的 stats_snapshots 快照，
 * 展示笔记总量/读完数的增长曲线（仅原生端，数据随同步积累）。
 */
export default function StatsTrendCard() {
  const [rows, setRows] = useState<StatsSnapshotRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (!isNativeApp) return;
      void queryStatsSnapshots()
        .then(data => { if (!cancelled) setRows(data); })
        .catch(() => { if (!cancelled) setRows([]); });
    };
    load();
    const off = onLocalReady(load);
    return () => { cancelled = true; off(); };
  }, []);

  const chartData = useMemo(() => (rows || []).map(r => ({
    date: r.date.slice(5), // MM-DD
    笔记总数: r.noteTotal,
    读完: r.finishedCount,
  })), [rows]);

  if (!isNativeApp || !rows || rows.length < 2) return null; // 少于两个快照画不出趋势

  const first = rows[0];
  const last = rows[rows.length - 1];
  const noteGrowth = last.noteTotal - first.noteTotal;

  const tooltipStyle = {
    borderRadius: '12px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--tooltip-bg)',
    color: 'var(--text-primary)',
  };

  return (
    <section
      className="rounded-2xl border p-4 sm:p-6 mb-6"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📈</span>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>阅读趋势</h3>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          首次同步以来 · 笔记 +{noteGrowth} · 读完 {last.finishedCount} 本
        </p>
      </div>
      <div style={{ height: 180 }}>
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
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        数据随每次同步自动累积，同步越多曲线越完整。
      </p>
    </section>
  );
}
