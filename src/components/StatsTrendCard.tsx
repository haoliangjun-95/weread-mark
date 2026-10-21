import { useEffect, useMemo, useState } from 'react';
import { lazy, Suspense } from 'react';
import { queryStatsSnapshots, isNativeApp } from '../services/localDb';
import type { StatsSnapshotRow } from '../services/localDb';
import { onLocalReady } from '../services/dataService';

// recharts 单独分包，卡片外壳（标题/统计行）不随图表库一起进主包
const TrendChart = lazy(() => import('./TrendChart'));

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
        <Suspense fallback={<div className="flex h-full items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>图表加载中...</div>}>
          <TrendChart chartData={chartData} />
        </Suspense>
      </div>
      <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        数据随每次同步自动累积，同步越多曲线越完整。
      </p>
    </section>
  );
}
