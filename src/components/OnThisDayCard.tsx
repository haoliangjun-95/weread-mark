import { useEffect, useMemo, useState } from 'react';
import type { BookItem } from '../types/weread';
import { getOnThisDay, onLocalReady } from '../services/dataService';
import type { OnThisDayItem } from '../services/localDb';
import { richTextToPlain } from '../utils/sanitize';
import type { HighlightTarget } from '../App';

interface OnThisDayCardProps {
  onSelectBook: (book: BookItem, target?: HighlightTarget) => void;
}

const COLLAPSE_THRESHOLD = 6;

const kindBadges: Record<OnThisDayItem['kind'], { label: string; bg: string; color: string }> = {
  highlight: { label: '划线', bg: 'var(--accent-light)', color: 'var(--accent-text)' },
  thought: { label: '想法', bg: 'var(--note-bg)', color: 'var(--note-text)' },
  review: { label: '书评', bg: 'var(--rank-gold-bg)', color: 'var(--rank-gold-text)' },
};

/** 往年今天：历年同月同日的划线/想法/书评，按年份分组（仅桌面版本地库，毫秒级查询） */
export default function OnThisDayCard({ onSelectBook }: OnThisDayCardProps) {
  const [items, setItems] = useState<OnThisDayItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void Promise.resolve().then(async () => {
        const data = await getOnThisDay();
        if (!cancelled) setItems(data);
      });
    };
    load();
    // 看板常驻挂载，同步可能晚于挂载完成——监听就绪事件重新查询
    const off = onLocalReady(load);
    return () => { cancelled = true; off(); };
  }, []);

  const groups = useMemo(() => {
    if (!items) return [];
    const map = new Map<number, OnThisDayItem[]>();
    items.forEach(item => {
      const year = new Date(item.createTime * 1000).getFullYear();
      const list = map.get(year) || [];
      list.push(item);
      map.set(year, list);
    });
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [items]);

  if (!items || items.length === 0) return null;

  const now = new Date();
  const dateLabel = `${now.getMonth() + 1} 月 ${now.getDate()} 日`;
  const visibleGroups = expanded ? groups : groups.slice(0, 2);
  const visibleCount = visibleGroups.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <section
      className="rounded-2xl border p-4 sm:p-6 mb-6"
      style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)', boxShadow: 'var(--shadow-sm)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">📖</span>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>往年今天</h3>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {dateLabel} · 共 {items.length} 条回忆
        </p>
      </div>

      <div className="space-y-4">
        {visibleGroups.map(([year, list]) => (
          <div key={year}>
            <p className="text-xs font-semibold mb-2 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
              <span className="inline-block w-4 h-4 rounded text-[10px] text-center leading-4"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>{String(year).slice(2)}</span>
              {year} 年的今天 · {list.length} 条
            </p>
            <div className="space-y-2">
              {list.map(item => {
                const badge = kindBadges[item.kind];
                const text = item.content || richTextToPlain(item.htmlContent || '');
                return (
                  <div
                    key={item.targetId}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectBook(item.book, { type: 'thought', id: item.targetId })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectBook(item.book, { type: 'thought', id: item.targetId });
                      }
                    }}
                    className="rounded-xl border px-3 py-2.5 transition-all hover:shadow-sm cursor-pointer"
                    style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-light)' }}
                  >
                    <p className="text-sm leading-relaxed line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                      {text}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                      <span className="font-medium truncate">《{item.book.title}》</span>
                      <span>
                        {new Date(item.createTime * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {(items.length > COLLAPSE_THRESHOLD || groups.length > 2) && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-4 w-full rounded-xl py-2 text-sm font-medium transition-colors"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          {expanded ? '收起' : `展开全部（${items.length - visibleCount} 条更多回忆）`}
        </button>
      )}
    </section>
  );
}
