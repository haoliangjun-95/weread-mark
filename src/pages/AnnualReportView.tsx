import { useEffect, useRef, useState } from 'react';
import { queryAnnualReport, queryReportYears, getSyncStatus } from '../services/localDb';
import type { AnnualReportData } from '../services/localDb';
import { isNativeApp } from '../services/localDb';
import { onLocalReady, isSynced } from '../services/dataService';
import { captureNodeToPng, resolveCoverSrc } from '../utils/exportImage';
import { saveOrShareDataUrl } from '../utils/share';
import { showToast } from '../utils/toast';

/**
 * 年度阅读报告（仅原生端，读本地库）：
 * 一年的划线/想法/书评痕迹、点赞收获、月度活跃、最常留痕的书与最赞想法，
 * 支持一键导出长图分享。
 */
export default function AnnualReportView() {
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [report, setReport] = useState<AnnualReportData | null>(null);
  /** report 对应的年份；与 year 不一致即视为加载中（派生 loading，避免 effect 内同步 setState） */
  const [reportYear, setReportYear] = useState<number | null>(null);
  const [synced, setSynced] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [coverSrcs, setCoverSrcs] = useState<Record<string, string>>({});
  const reportRef = useRef<HTMLDivElement>(null);

  // 可用年份 + 同步状态：挂载时与本地库就绪事件各刷一次（setState 均在 await 之后）
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void (async () => {
        try {
          const [ys, ok, status] = await Promise.all([
            queryReportYears(), isSynced(), getSyncStatus(),
          ]);
          if (cancelled) return;
          setSynced(ok);
          setLastSyncAt(status.lastSyncAt);
          const currentYear = new Date().getFullYear();
          const list = ys.length ? ys : [currentYear];
          setYears(list);
          // 默认当前年；用户在当前年无痕迹时回退到最近有数据的年份
          setYear(prev => list.includes(prev) ? prev : (list.includes(currentYear) ? currentYear : list[0]));
        } catch (err) {
          console.warn('[AnnualReport] 加载失败：', err);
        }
      })();
    };
    refresh();
    const off = onLocalReady(refresh);
    return () => { cancelled = true; off(); };
  }, []);

  // 切换年份（含首次）：加载对应年报
  useEffect(() => {
    if (!years.includes(year)) return;
    let cancelled = false;
    void queryAnnualReport(year)
      .then(r => {
        if (cancelled) return;
        setReport(r);
        setReportYear(year);
      })
      .catch(err => console.warn('[AnnualReport] 切年失败：', err));
    return () => { cancelled = true; };
  }, [year, years]);

  // 封面地址解析（鸿蒙桥取 dataURL）
  useEffect(() => {
    if (!report) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(report.topBooks.map(async b => [b.bookId, await resolveCoverSrc(b.cover)] as const));
      if (!cancelled) setCoverSrcs(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [report]);

  const handleExport = async () => {
    if (exporting || !reportRef.current) return;
    setExporting(true);
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#f3f6fb';
      const dataUrl = await captureNodeToPng(reportRef.current, bg);
      await saveOrShareDataUrl(dataUrl, `微痕-${year}年度阅读报告.png`);
    } catch (err) {
      console.error('[AnnualReport] 导出失败：', err);
      showToast(`导出失败：${err instanceof Error ? err.message : '请重试'}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!isNativeApp) return null;

  const loading = report === null || reportYear !== year;
  if (loading) {
    return (
      <div className="py-24 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        正在翻阅你的阅读足迹...
      </div>
    );
  }

  if (!synced || !report) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-4xl mb-4">🎁</p>
        <p className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>年报需要本地数据</p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          前往「设置 → 本地数据同步」完成一次同步后，这里会为你生成年度阅读报告。
        </p>
      </div>
    );
  }

  const totalTraces = report.totalMarks + report.totalThoughts + report.totalReviews;
  const maxMonth = Math.max(1, ...report.monthActivity);
  const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const bestMonth = report.monthActivity.indexOf(Math.max(...report.monthActivity));
  const stats = [
    { label: '划线', value: report.totalMarks, icon: '✏️' },
    { label: '想法', value: report.totalThoughts, icon: '💭' },
    { label: '书评', value: report.totalReviews, icon: '⭐' },
    { label: '收到点赞', value: report.likesReceived, icon: '❤️' },
    ...(report.finishedDelta != null ? [{ label: '读完', value: `${report.finishedDelta} 本`, icon: '🏁' }] : []),
    ...(report.readingMinutes != null ? [{ label: '阅读时长', value: report.readingMinutes >= 60 ? `${Math.round(report.readingMinutes / 60)} 小时` : `${report.readingMinutes} 分钟`, icon: '⏱️' }] : []),
  ];

  return (
    <div className="py-6">
      {/* 年份切换 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {years.map(y => (
          <button
            key={y}
            type="button"
            onClick={() => setYear(y)}
            className="rounded-full px-4 py-1.5 text-sm font-medium transition-all"
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
        <span className="flex-1" />
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-60"
          style={{ backgroundColor: 'var(--accent-color)' }}
        >
          {exporting ? '生成中...' : '🖼 分享长图'}
        </button>
      </div>

      <div ref={reportRef} className="space-y-5 rounded-3xl border p-5 sm:p-8" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-light)' }}>
        {/* 头部 */}
        <div className="rounded-2xl px-6 py-8 text-center" style={{ background: 'var(--gradient-hero)' }}>
          <p className="text-xs font-medium tracking-widest" style={{ color: 'var(--text-muted)' }}>微痕 · 年度阅读报告</p>
          <h2 className="mt-2 text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>{report.year}</h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            这一年你留下了 <span className="font-bold" style={{ color: 'var(--accent-text)' }}>{totalTraces}</span> 条阅读痕迹，
            涉及 <span className="font-bold" style={{ color: 'var(--accent-text)' }}>{report.topBooks.length > 0 ? '多' : '0'}</span>本书
            {bestMonth >= 0 && report.monthActivity[bestMonth] > 0 && <>，{monthLabels[bestMonth]}最为活跃</>}
          </p>
        </div>

        {/* 数据总览 */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map(s => (
            <div key={s.label} className="rounded-2xl border p-4 text-center" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <p className="text-lg">{s.icon}</p>
              <p className="mt-1 text-xl font-bold break-all" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* 月度活跃 */}
        <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <p className="mb-4 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>月度活跃</p>
          <div className="flex items-end gap-1.5" style={{ height: 120 }}>
            {report.monthActivity.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px]" style={{ color: v > 0 ? 'var(--text-secondary)' : 'transparent' }}>{v || '0'}</span>
                <div
                  className="w-full rounded-t-md transition-all"
                  style={{
                    height: `${Math.max(v > 0 ? 8 : 2, (v / maxMonth) * 84)}px`,
                    backgroundColor: v > 0 ? 'var(--chart-bar)' : 'var(--border-light)',
                  }}
                />
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>按划线/想法/书评的创建时间统计</p>
        </div>

        {/* 最常留痕的书 */}
        {report.topBooks.length > 0 && (
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
            <p className="mb-4 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>最常留下痕迹的书</p>
            <div className="space-y-3">
              {report.topBooks.map((b, i) => (
                <div key={b.bookId} className="flex items-center gap-3">
                  <span className="w-6 text-center text-sm font-bold" style={{ color: i === 0 ? 'var(--rating-text)' : 'var(--text-muted)' }}>{i + 1}</span>
                  {coverSrcs[b.bookId]
                    ? <img src={coverSrcs[b.bookId]} alt="" className="h-12 w-9 flex-shrink-0 rounded object-cover" crossOrigin="anonymous" />
                    : <div className="flex h-12 w-9 flex-shrink-0 items-center justify-center rounded text-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>📖</div>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{b.title}</p>
                    <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{b.author}</p>
                  </div>
                  <p className="flex-shrink-0 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {b.marks} 划线{b.thoughts > 0 && ` · ${b.thoughts} 想法`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 最赞想法 */}
        {report.topReview && (
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--note-bg)', borderColor: 'var(--note-border)' }}>
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--note-text)' }}>
              💭 年度最赞想法 <span className="text-xs font-normal">❤️ {report.topReview.likesCount}</span>
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{report.topReview.content}</p>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>《{report.topReview.bookTitle}》</p>
          </div>
        )}

        {/* 第一条划线 */}
        {report.firstMark && (
          <div className="rounded-2xl border p-5" style={{ backgroundColor: 'var(--mark-bg)', borderColor: 'var(--highlight-ring)' }}>
            <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--mark-text)' }}>
              ✏️ 这一年，你的第一条划线
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>{report.firstMark.content}</p>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              《{report.firstMark.bookTitle}》· {new Date(report.firstMark.createTime * 1000).toLocaleDateString('zh-CN')}
            </p>
          </div>
        )}

        {/* 底部品牌 */}
        <p className="pt-2 text-center text-xs tracking-[0.3em]" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>
          微 痕 · 让阅读留下痕迹
          {lastSyncAt ? ` · 数据截至 ${new Date(lastSyncAt * 1000).toLocaleDateString('zh-CN')}` : ''}
        </p>
      </div>
    </div>
  );
}
