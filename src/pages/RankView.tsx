import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { BookItem } from '../types/weread';
import type { TopReviewItem } from '../services/localDb';
import { getTopReviews, isTauri } from '../services/dataService';
import { hasLocalData, getLastSyncAt } from '../services/localDb';
import { useInfiniteScroll } from '../utils/filterUtils';
import { SkeletonGrid } from '../components/Skeleton';
import { richTextToPlain } from '../utils/sanitize';
import type { HighlightTarget } from '../App';

interface RankViewProps {
  onSelectBook: (book: BookItem, target?: HighlightTarget) => void;
}

type RankTab = 'all' | 'thought' | 'review';

const PAGE_SIZE = 30;

function stripHtml(html: string): string {
  // DOMParser 文档不加载子资源，避免 innerHTML 触发 img onerror 等副作用
  return richTextToPlain(html);
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

const rankMedals = ['🥇', '🥈', '🥉'];

export default function RankView({ onSelectBook }: RankViewProps) {
  const [items, setItems] = useState<TopReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<RankTab>('all');
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [localMode, setLocalMode] = useState(false);
  const [lastSyncText, setLastSyncText] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    setError(null);
    try {
      const data = await getTopReviews(500, p => {
        setScanning(true);
        setProgress(p);
      }, () => cancelledRef.current);
      if (cancelledRef.current) return;
      setItems(data);
      if (isTauri) {
        setLocalMode(await hasLocalData());
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : '加载排行榜失败');
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
        setScanning(false);
      }
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    if (isTauri) {
      void getLastSyncAt().then(t => {
        if (t) setLastSyncText(`数据截至：${new Date(t * 1000).toLocaleString('zh-CN')}`);
      });
    }
    return () => { cancelledRef.current = true; };
  }, [load]);

  const updateTab = useCallback((next: RankTab) => {
    setTab(next);
    setDisplayCount(PAGE_SIZE);
  }, []);

  const filtered = useMemo(() => {
    if (tab === 'all') return items;
    return items.filter(item => (tab === 'review' ? item.type === 4 : item.type !== 4));
  }, [items, tab]);

  const hasMore = displayCount < filtered.length;
  const sentinelRef = useInfiniteScroll(hasMore, () => setDisplayCount(c => c + PAGE_SIZE), displayCount);
  const visible = filtered.slice(0, displayCount);

  const thoughtCount = useMemo(() => items.filter(i => i.type !== 4).length, [items]);
  const reviewCount = useMemo(() => items.filter(i => i.type === 4).length, [items]);

  if (loading && items.length === 0) {
    return (
      <div>
        <div className="mb-6">
          <h2 className="text-xl sm:text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>🏆 点赞排行榜</h2>
          {scanning && progress.total > 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>正在扫描 {progress.done}/{progress.total} 本书...</p>
          )}
        </div>
        <SkeletonGrid count={8} />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => void load()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">重试</button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-4 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>🏆 点赞排行榜</h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              按点赞数排序的想法与书评
              {lastSyncText && ` · ${lastSyncText}`}
              {localMode && !lastSyncText && ' · 本地数据'}
            </p>
          </div>
          <div className="text-xs sm:text-sm flex items-center gap-3" style={{ color: 'var(--text-secondary)' }}>
            <span>💭 {thoughtCount} 想法</span>
            <span>⭐ {reviewCount} 书评</span>
          </div>
        </div>

        <div className="flex gap-1 border-b mb-5" style={{ borderColor: 'var(--border-color)' }}>
          {([
            { key: 'all' as RankTab, label: `全部 ${items.length}` },
            { key: 'thought' as RankTab, label: `想法 ${thoughtCount}` },
            { key: 'review' as RankTab, label: `书评 ${reviewCount}` },
          ]).map(t => {
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => updateTab(t.key)}
                className="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
                style={{
                  borderColor: isActive ? 'var(--accent-color)' : 'transparent',
                  color: isActive ? 'var(--accent-color)' : 'var(--text-muted)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {scanning && (
        <div className="mb-4 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          刷新中 {progress.done}/{progress.total} 本书...
        </div>
      )}

      {visible.length === 0 ? (
        <div className="text-center py-20">
          <span className="text-4xl mb-4 block">🏆</span>
          <p style={{ color: 'var(--text-muted)' }}>还没有获得点赞的想法或书评</p>
        </div>
      ) : (
        <div className="space-y-3 sm:space-y-4">
          {visible.map((item, idx) => {
            const rank = idx + 1;
            const isReview = item.type === 4;
            const text = item.content || stripHtml(item.htmlContent || '');
            const book: BookItem = {
              bookId: item.bookId, title: item.bookTitle, author: item.bookAuthor,
              cover: item.bookCover, category: '', readUpdateTime: 0, finishReading: 0,
              updateTime: 0, isTop: 0, secret: 0,
            };
            return (
              <div
                key={item.reviewId}
                role="button"
                tabIndex={0}
                onClick={() => onSelectBook(book, { type: 'thought', id: item.reviewId })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectBook(book, { type: 'thought', id: item.reviewId });
                  }
                }}
                className="flex items-start gap-3 sm:gap-4 rounded-2xl border p-4 sm:p-5 transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
                style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
              >
                <div className="flex-shrink-0 w-9 text-center">
                  {rank <= 3 ? (
                    <span className="text-2xl">{rankMedals[rank - 1]}</span>
                  ) : (
                    <span className="text-sm font-bold" style={{ color: 'var(--text-muted)' }}>{rank}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="leading-relaxed line-clamp-3 whitespace-pre-wrap break-words" style={{ color: 'var(--text-primary)' }}>
                    {text}
                  </p>
                  <div className="flex items-center gap-2 mt-3 text-xs flex-wrap" style={{ color: 'var(--text-muted)' }}>
                    <span className="px-1.5 py-0.5 rounded text-[10px]"
                      style={isReview
                        ? { backgroundColor: 'var(--rank-gold-bg)', color: 'var(--rank-gold-text)' }
                        : { backgroundColor: 'var(--note-bg)', color: 'var(--note-text)' }}>
                      {isReview ? '书评' : '想法'}
                    </span>
                    <span className="font-medium truncate">《{item.bookTitle}》</span>
                    <span>{formatDate(item.createTime)}</span>
                    {item.chapterName && (
                      <>
                        <span>·</span>
                        <span className="truncate max-w-40">{item.chapterName}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 flex items-center gap-1 text-sm font-semibold"
                  style={{ color: 'var(--like-text)' }}>
                  ❤️ {item.likesCount}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          上拉加载更多（已显示 {visible.length}/{filtered.length} 条）
        </div>
      )}
      {!hasMore && filtered.length > PAGE_SIZE && (
        <div className="text-center py-6 text-sm" style={{ color: 'var(--text-muted)' }}>
          — 已显示全部 {filtered.length} 条 —
        </div>
      )}
    </div>
  );
}
