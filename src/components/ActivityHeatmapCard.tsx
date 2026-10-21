import { useEffect, useMemo, useState } from 'react';
import { queryDayCounts, queryReportYears, isNativeApp } from '../services/localDb';
import { onLocalReady, isSynced } from '../services/dataService';
import { fetchReadingStats } from '../services/weread';
import { buildYearGrid, intensityOf } from '../utils/heatmap';

/**
 * 看板活跃热力图（GitHub contributions 风格，参考 Obsidian Heatmap Calendar）：
 * - 原生端（本地库）：每日划线/想法/书评条数
 * - Web：每日阅读分钟数（readTimes 聚合）
 * 强度分级沿用 sqrt 归一化（低量日也能区分深浅）。
 */

/** 热力颜色（绿色 5 档，level 0 = 无数据底色） */
const LEVEL_COLORS = ['#c6e48b', '#7bc96f', '#49af5d', '#2e8840', '#196127'];

interface ActivityHeatmapCardProps {
  /** Web 端 readTimes 数据（键=秒级时间戳，值=秒），由 Dashboard 传入避免重复请求 */
  webReadTimes?: Record<string, number>;
}

export default function ActivityHeatmapCard({ webReadTimes }: ActivityHeatmapCardProps) {
  const currentYear = new Date().getFullYear();
  const [years, setYears] = useState<number[]>([currentYear, currentYear - 1]);
  const [year, setYear] = useState(currentYear);
  const [counts, setCounts] = useState<Record<string, number>>({});
  /** counts 对应的年份；与 year 不一致即加载中（派生，避免 effect 内同步 setState） */
  const [countsYear, setCountsYear] = useState<number | null>(null);
  const [unit, setUnit] = useState<'条' | '分钟'>('条');

  // 原生端：有痕迹的年份列表（挂载与本地库就绪时刷新；setState 均在 await 之后）
  useEffect(() => {
    if (!isNativeApp) return;
    let cancelled = false;
    const refresh = () => {
      void (async () => {
        try {
          const [ys, ok] = await Promise.all([queryReportYears(), isSynced()]);
          if (cancelled || !ok) return;
          const list = ys.length ? ys.slice(0, 6) : [currentYear];
          setYears(list);
          setYear(prev => list.includes(prev) ? prev : list[0]);
        } catch (err) {
          console.warn('[Heatmap] 年份加载失败：', err);
        }
      })();
    };
    refresh();
    const off = onLocalReady(refresh);
    return () => { cancelled = true; off(); };
  }, [currentYear]);

  // 切年加载每日计数
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (isNativeApp) {
          const ok = await isSynced();
          if (cancelled) return;
          setUnit('条');
          const data = ok ? await queryDayCounts(year) : {};
          if (!cancelled) {
            setCounts(data);
            setCountsYear(year);
          }
        } else {
          setUnit('分钟');
          // 今年优先复用 Dashboard 传入的 readTimes，其余年份单独请求
          const source = year === currentYear && webReadTimes
            ? webReadTimes
            : (await fetchReadingStats('annually', new Date(year, 0, 1).getTime() / 1000).catch(() => null))?.readTimes || {};
          if (cancelled) return;
          const aggregated: Record<string, number> = {};
          for (const [ts, secs] of Object.entries(source)) {
            const d = new Date(Number(ts) * 1000);
            if (d.getFullYear() !== year || !Number(secs)) continue;
            const key = `${d.getMonth() + 1}-${d.getDate()}`;
            aggregated[key] = (aggregated[key] || 0) + Math.round(Number(secs) / 60);
          }
          setCounts(aggregated);
          setCountsYear(year);
        }
      } catch (err) {
        console.warn('[Heatmap] 数据加载失败：', err);
        if (!cancelled) {
          setCounts({});
          setCountsYear(year);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [year, webReadTimes, currentYear]);

  const loading = countsYear !== year;
  const grid = useMemo(() => buildYearGrid(year), [year]);
  const max = useMemo(() => Math.max(1, ...Object.values(counts)), [counts]);
  const activeDays = useMemo(() => Object.values(counts).filter(v => v > 0).length, [counts]);
  const todayKey = `${new Date().getMonth() + 1}-${new Date().getDate()}`;

  // 历史年份无数据：整卡隐藏（当年保留空网格做引导）
  if (!loading && activeDays === 0 && year !== currentYear) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border p-4 sm:p-6 mb-6"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-lg">🔥</span>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isNativeApp ? '划线热力' : '阅读热力'}
          </h3>
          {!loading && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {year} 年 · {activeDays} 个活跃日{activeDays > 0 && ` · 最浓一天 ${max} ${unit}`}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {years.map(y => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className="rounded-full px-3 py-1 text-xs font-medium transition-all"
              style={{
                backgroundColor: y === year ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: y === year ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: y === year ? 'var(--accent-color)' : 'var(--border-light)',
              }}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-24 items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
          正在聚合阅读足迹...
        </div>
      ) : (
        <>
          <div className="overflow-x-auto pb-1">
            <div className="inline-block min-w-full">
              {/* 月份标签行 */}
              <div className="mb-1 flex" style={{ marginLeft: 22 }}>
                {Array.from({ length: grid.weeks.length }, (_, col) => {
                  const label = grid.monthLabels.find(l => l.col === col);
                  return (
                    <div key={col} className="text-[10px] leading-none" style={{ width: 12, marginRight: 2, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'visible' }}>
                      {label ? label.label : ''}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1">
                {/* 周几标签列（周一/周四/周日） */}
                <div className="flex flex-col justify-between pr-1" style={{ width: 18 }}>
                  {['一', '', '', '四', '', '', '日'].map((w, i) => (
                    <span key={i} className="text-[9px] leading-none" style={{ color: 'var(--text-muted)', height: 12 }}>{w}</span>
                  ))}
                </div>
                {/* 格子矩阵 */}
                <div className="flex flex-col gap-[2px]">
                  {Array.from({ length: 7 }, (_, day) => (
                    <div key={day} className="flex gap-[2px]">
                      {grid.weeks.map((week, col) => {
                        const cell = week[day];
                        if (!cell.key) {
                          return <span key={col} style={{ width: 12, height: 12 }} />;
                        }
                        const value = counts[cell.key] || 0;
                        const level = intensityOf(value, max);
                        const isToday = year === currentYear && cell.key === todayKey;
                        return (
                          <span
                            key={col}
                            title={value > 0 ? `${cell.date ?? ''} · ${value} ${unit}` : (cell.date ?? '')}
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: 2.5,
                              backgroundColor: level > 0 ? LEVEL_COLORS[level - 1] : 'var(--bg-tertiary)',
                              outline: isToday ? '1.5px solid var(--accent-color)' : 'none',
                              outlineOffset: isToday ? '1px' : 0,
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          {/* 图例 */}
          <div className="mt-3 flex items-center justify-end gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <span className="mr-1">少</span>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: 'var(--bg-tertiary)' }} />
            {LEVEL_COLORS.map(c => (
              <span key={c} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c }} />
            ))}
            <span className="ml-1">多</span>
          </div>
        </>
      )}
    </section>
  );
}
