import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import type { BookItem, ReviewItem } from '../types/weread';
import { fetchAllNotebooks, fetchBookReviews } from '../services/weread';
import { useInfiniteScroll } from '../utils/filterUtils';
import { exportReviewToPdf } from '../utils/exportPdf';
import { exportItemToImage } from '../utils/exportImage';
import type { ExportStyleType } from '../App';
import exportImg from '../assets/export-img.png';
import exportPdf from '../assets/export-pdf.png';

interface MyReview {
  book: BookItem;
  review: ReviewItem['review'];
  likesCount?: number;
}

const CONCURRENCY = 10;
const CACHE_KEY = 'weread-reviews-cache-v3';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const BATCH_SIZE = 20;

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

export default function ReviewsView() {
  const [reviews, setReviews] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setReviews([]);
      cancelledRef.current = false;

      // 尝试读缓存
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw) as { ts: number; data: MyReview[] };
          if (Date.now() - cached.ts < CACHE_TTL_MS && cached.data.length >= 0) {
            setReviews(cached.data);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Ignore malformed or unavailable session storage cache.
      }

      const notebooks = await fetchAllNotebooks();
      const books = (notebooks.books || []).filter(n => n.book && (n.reviewCount || 0) > 0);
      setProgress({ done: 0, total: books.length });
      setScanning(true);

      const all: MyReview[] = [];
      for (let i = 0; i < books.length; i += CONCURRENCY) {
        if (cancelledRef.current) return;
        const slice = books.slice(i, i + CONCURRENCY);
        const settled = await Promise.all(
          slice.map(async n => {
            try {
              const rv = await fetchBookReviews(n.bookId);
          return (rv.reviews || [])
            .filter(r => r.review?.type === 4 && (r.review.htmlContent || r.review.content))
            .map(r => ({ book: n.book as BookItem, review: r.review, likesCount: r.likesCount }));
            } catch {
              return [] as MyReview[];
            }
          })
        );
        settled.forEach(batch => all.push(...batch));
        all.sort((a, b) => b.review.createTime - a.review.createTime);
        if (cancelledRef.current) return;
        setReviews([...all]);
        setProgress({ done: Math.min(i + CONCURRENCY, books.length), total: books.length });
      }

      // 写缓存
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: all }));
      } catch {
        // Cache writes are opportunistic.
      }

      setScanning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载书评失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    return () => { cancelledRef.current = true; };
  }, [load]);

  const kw = search.trim().toLowerCase();
  const filtered = kw
    ? reviews.filter(item =>
        item.book.title?.toLowerCase().includes(kw) ||
        item.book.author?.toLowerCase().includes(kw)
      )
    : reviews;

  const visible = filtered.slice(0, displayCount);
  const hasMore = displayCount < filtered.length;
  const loadMore = useCallback(() => setDisplayCount(c => c + BATCH_SIZE), []);
  const sentinelRef = useInfiniteScroll(hasMore, loadMore, displayCount);

  const updateSearch = useCallback((value: string) => {
    setSearch(value);
    setDisplayCount(BATCH_SIZE);
  }, []);

  if (loading && reviews.length === 0) {
    return (
      <div className="text-center py-20 text-gray-500">
        加载书评中...
        {progress.total > 0 && (
          <p className="text-sm mt-2">已扫描 {progress.done} / {progress.total} 本书</p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={load}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900">书评墙</h2>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              {kw ? `${filtered.length} / ${reviews.length}` : reviews.length} 条书评
              {scanning && progress.total > 0 && (
                <span className="ml-2 text-xs text-gray-400">
                  · 扫描中 {progress.done}/{progress.total}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 self-end sm:self-auto">
<button
              onClick={load}
              className="flex-shrink-0 text-sm text-blue-600 hover:text-blue-700 px-2 py-1"
            >
              刷新
            </button>
          </div>
        </div>
        <div className="mt-3 sm:mt-4">
          <input
            type="text"
            value={search}
            onChange={e => updateSearch(e.target.value)}
            placeholder="按书名或作者搜索..."
            className="w-full px-3 sm:px-4 py-2.5 sm:py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
          />
        </div>
      </div>

      {filtered.length === 0 && !scanning ? (
        <div className="text-center py-20 text-gray-400">
          {reviews.length === 0 ? '暂无书评' : '没有匹配的书评'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {visible
              .filter(item => item.review.htmlContent || item.review.content)
              .map(item => (
                <ReviewCard key={item.review.reviewId} item={item} />
              ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="text-center py-6 text-sm text-gray-400">
              加载中...
            </div>
          )}
          {!hasMore && filtered.length > BATCH_SIZE && (
            <div className="text-center py-6 text-sm text-gray-400">
              — 已显示全部 {filtered.length} 条 —
            </div>
          )}
        </>
      )}
    </div>
  );
}

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.innerText || tmp.textContent || '';
}

const COLLAPSED_MAX_HEIGHT = 180;

function ReviewCard({ item }: { item: MyReview }) {
  const { book, review } = item;
  const coverUrl = book.cover?.startsWith('http')
    ? book.cover
    : `https://weread-1258476243.file.myqcloud.com${book.cover}`;

  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportStyle = (() => {
    try {
      const saved = localStorage.getItem('weread-export-style');
      const VALID: ExportStyleType[] = ['classic', 'paper', 'dark'];
      return saved && VALID.includes(saved as ExportStyleType) ? saved as ExportStyleType : 'classic';
    } catch { return 'classic' as ExportStyleType; }
  })();

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollHeight > COLLAPSED_MAX_HEIGHT + 4);
    };
    check();
    const imgs = el.querySelectorAll('img');
    imgs.forEach(img => {
      if (!img.complete) img.addEventListener('load', check, { once: true });
    });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [review.htmlContent, review.content]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [previewOpen]);

  const hasBody = review.htmlContent || review.content;
  const stars = Math.max(0, Math.min(5, Math.round((review.star ?? 0) / 20)));

  return (
    <>
    <div className="h-full bg-white rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-4 lg:p-5 hover:shadow-md transition-shadow flex flex-col">
      <div className="flex gap-2.5 sm:gap-3">
        <div className="flex-shrink-0 w-12 h-16 sm:w-14 sm:h-20 bg-gray-100 rounded-md overflow-hidden">
          {book.cover ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="w-full h-full object-cover"
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xl sm:text-2xl">书</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm sm:text-base line-clamp-2 leading-snug">{book.title}</h3>
          <p className="text-xs text-gray-500 truncate mt-0.5 sm:mt-1">{book.author}</p>
          {stars > 0 && (
            <div className="mt-1">
              <span className="text-xs text-yellow-500">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
            </div>
          )}
        </div>
      </div>

      {hasBody && (
        <div className="relative mt-3 flex-1">
          <div
            ref={contentRef}
            className="overflow-hidden"
            style={{ maxHeight: `${COLLAPSED_MAX_HEIGHT}px` }}
          >
            {review.htmlContent ? (
              <div
                className="text-sm text-gray-700 leading-relaxed thought-html"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(review.htmlContent) }}
              />
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {review.content}
              </p>
            )}
          </div>
          {overflow && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent" />
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-1.5 sm:gap-2">
        <p className="text-xs text-gray-400 flex items-center gap-1.5 sm:gap-2 min-w-0">
          <span className="truncate">{formatDate(review.createTime)}</span>
          {(item.likesCount ?? 0) > 0 && (
            <span className="text-red-400 flex-shrink-0">♥ {item.likesCount}</span>
          )}
        </p>
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            onClick={async () => {
              setExporting(true);
              try {
                await exportItemToImage({
                  bookTitle: book.title || '',
                  bookAuthor: book.author || '',
                  bookCover: book.cover,
                  type: 'review',
                  htmlContent: review.htmlContent,
                  content: review.content || stripHtml(review.htmlContent || ''),
                  time: formatDate(review.createTime),
                  likesCount: item.likesCount,
                  stars,
                  style: exportStyle,
                });
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full text-sm transition-colors hover:bg-gray-100 active:scale-95"
            style={{ color: 'var(--text-muted)' }}
            title={exporting ? '正在生成...' : '导出图片'}
          >{exporting ? '⏳' : <span className="w-4 h-4 sm:w-5 sm:h-5 block" style={{ backgroundImage: `url(${exportImg})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />}</button>
          <button
            onClick={() => exportReviewToPdf({
              bookTitle: book.title || '',
              bookAuthor: book.author || '',
              bookCover: book.cover,
              stars,
              createTime: formatDate(review.createTime),
              likesCount: item.likesCount,
              htmlContent: review.htmlContent,
              textContent: review.content,
            })}
            className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full text-sm transition-colors hover:bg-gray-100 active:scale-95"
            style={{ color: 'var(--text-muted)' }}
            title="导出PDF"
          >
            <img src={exportPdf} alt="导出PDF" className="w-4 h-4 sm:w-5 sm:h-5 object-contain" />
          </button>
          <button
            onClick={() => setPreviewOpen(true)}
            className="flex-shrink-0 text-xs text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-200 px-2 sm:px-3 py-1 rounded-full transition-colors active:scale-95"
          >
            预览
          </button>
        </div>
      </div>
    </div>

    {previewOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
        onClick={() => setPreviewOpen(false)}
      >
        <div
          className="rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[88vh] flex flex-col overflow-hidden animate-scale-in"
          style={{ backgroundColor: 'var(--card-bg)' }}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-start gap-3 sm:gap-4 p-4 sm:p-5 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <div className="flex-shrink-0 w-14 h-18 sm:w-16 sm:h-22 rounded-md overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              {book.cover ? (
                <img src={coverUrl} alt={book.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xl sm:text-2xl" style={{ color: 'var(--text-muted)' }}>📖</div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm sm:text-base leading-snug" style={{ color: 'var(--text-primary)' }}>{book.title}</h3>
              <p className="text-xs mt-0.5 sm:mt-1" style={{ color: 'var(--text-secondary)' }}>{book.author}</p>
              {stars > 0 && (
                <div className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-yellow-500">
                  {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
                </div>
              )}
              <p className="text-xs mt-1.5 sm:mt-2 flex items-center gap-2 sm:gap-3" style={{ color: 'var(--text-muted)' }}>
                <span>{formatDate(review.createTime)}</span>
                {(item.likesCount ?? 0) > 0 && (
                  <span className="text-red-400">♥ {item.likesCount}</span>
                )}
              </p>
            </div>
            <button
              onClick={() => setPreviewOpen(false)}
              className="flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full transition-colors hover:bg-black/5 active:scale-95"
              style={{ color: 'var(--text-muted)' }}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {review.htmlContent ? (
              <div
                className="text-sm sm:text-base leading-relaxed thought-html"
                style={{ color: 'var(--text-primary)' }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(review.htmlContent) }}
              />
            ) : (
              <p className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                {review.content}
              </p>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
