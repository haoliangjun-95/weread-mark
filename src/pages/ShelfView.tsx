import { useState, useEffect, useCallback } from 'react';
import type { BookItem } from '../types/weread';
import { fetchShelf, fetchAllNotebooks, fetchBookReviews } from '../services/weread';
import { FilterBar } from '../utils/filters';
import { collectCategories, applyFilters, useInfiniteScroll } from '../utils/filterUtils';
import type { HighlightTarget } from '../App';

interface ShelfViewProps {
  onSelectBook: (book: BookItem, target?: HighlightTarget) => void;
}

const BATCH_SIZE = 30;
const SHELF_COVER_BASE = 'https://weread-1258476243.file.myqcloud.com';

export default function ShelfView({ onSelectBook }: ShelfViewProps) {
  const [activeTab, setActiveTab] = useState<'shelf' | 'finished'>('shelf');

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-4 sm:mb-6 overflow-x-auto">
        {(['shelf', 'finished'] as const).map(tab => {
          const isActive = activeTab === tab;
          const label = tab === 'shelf' ? '我的书架' : '已读完书架';
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={'px-4 sm:px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ' + (isActive ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700')}
            >
              {label}
            </button>
          );
        })}
      </div>
      {activeTab === 'shelf' && <ShelfTab onSelectBook={onSelectBook} />}
      {activeTab === 'finished' && <FinishedTab onSelectBook={onSelectBook} />}
    </div>
  );
}

function BookCard({ book, progress, noteCount, thoughtCount, hasBookReview, onClick, onReviewClick, onNoteClick, onThoughtClick }: {
  book: BookItem;
  progress?: number;
  noteCount?: number;
  thoughtCount?: number;
  hasBookReview?: boolean;
  onClick: () => void;
  onReviewClick?: () => void;
  onNoteClick?: () => void;
  onThoughtClick?: () => void;
}) {
  const coverUrl = book.cover?.startsWith('http') ? book.cover : SHELF_COVER_BASE + (book.cover || '');


  const hasAnyContent = (noteCount ?? 0) > 0 || (thoughtCount ?? 0) > 0 || hasBookReview;

  return (
    <div
      onClick={hasAnyContent ? onClick : undefined}
      role={hasAnyContent ? "button" : undefined}
      tabIndex={hasAnyContent ? 0 : undefined}
      onKeyDown={hasAnyContent ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`h-full w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm p-3 sm:p-4 transition-all flex flex-col focus:outline-none focus:ring-2 focus:ring-blue-400 ${hasAnyContent ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default opacity-70'}`}
    >
      <div className="w-full aspect-[3/4] bg-gray-100 rounded-lg overflow-hidden mb-3">
        {book.cover ? (
          <img
            src={coverUrl}
            alt={book.title}
            className="w-full h-full object-cover"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-3xl">📕</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm line-clamp-2 min-h-[2.5rem]">{book.title}</p>
        <p className="text-xs text-gray-500 truncate mt-1">{book.author}</p>
        {progress !== undefined && progress > 0 && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className={progress >= 100 ? 'text-green-600 font-medium' : 'text-gray-500'}>
                {progress >= 100 ? '✓ 已读完' : '阅读进度'}
              </span>
              <span className={progress >= 100 ? 'text-green-600' : 'text-gray-500'}>
                {Math.round(progress)}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-green-500' : 'bg-orange-400'}`}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center flex-wrap gap-1.5 mt-2">
          {(noteCount ?? 0) > 0 && (
            <button type="button" onClick={e => { e.stopPropagation(); onNoteClick?.(); }} className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors cursor-pointer">📍 {noteCount}</button>
          )}
          {(thoughtCount ?? 0) > 0 && (
            <button type="button" onClick={e => { e.stopPropagation(); onThoughtClick?.(); }} className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-600 hover:bg-purple-100 transition-colors cursor-pointer">💭 {thoughtCount}</button>
          )}
          {hasBookReview && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); if (onReviewClick) { onReviewClick(); } else { onClick(); } }}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-50 text-yellow-600 hover:bg-yellow-100 transition-colors cursor-pointer"
              title="查看书评"
            >⭐</button>
          )}
        </div>
      </div>
    </div>
  );
}

function ShelfTab({ onSelectBook }: { onSelectBook: (book: BookItem, target?: HighlightTarget) => void }) {
  const [shelfBooks, setShelfBooks] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);
  const [noteCountMap, setNoteCountMap] = useState<Record<string, number>>({});
  const [thoughtCountMap, setThoughtCountMap] = useState<Record<string, number>>({});
  const [bookReviewMap, setBookReviewMap] = useState<Record<string, boolean>>({});
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});

  const loadShelf = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const shelfData = await fetchShelf();
      const books = (shelfData.books || []).filter(b => b.bookId);
      setShelfBooks(books);
      setLoading(false);

      // 笔记 & 想法数 & 阅读进度后台异步加载
      fetchAllNotebooks().then(notebooksData => {
        const nm: Record<string, number> = {};
        const tm: Record<string, number> = {};
        const pm: Record<string, number> = {};
        notebooksData.books.forEach(nb => {
          nm[nb.bookId] = nb.noteCount;
          tm[nb.bookId] = nb.reviewCount;
          if (nb.readingProgress !== undefined) pm[nb.bookId] = nb.readingProgress;
        });
        setNoteCountMap(nm);
        setThoughtCountMap(tm);
        setProgressMap(pm);
      }).catch(() => {
        // Background metadata enrichments should not block the shelf view.
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : '加载书架失败');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadShelf);
  }, [loadShelf]);

  const filtered = applyFilters(shelfBooks, b => b, keyword, category);
  const categories = collectCategories(shelfBooks);
  const visible = filtered.slice(0, displayCount);
  const hasMore = displayCount < filtered.length;
  const loadMore = useCallback(() => setDisplayCount(c => c + BATCH_SIZE), []);
  const sentinelRef = useInfiniteScroll(hasMore, loadMore, displayCount);

  // 增量扫描当前可见的书的书评（仅 thoughtCount > 0 才有可能含书评，且未扫描过的）
  useEffect(() => {
    const candidates = visible
      .filter(b => (thoughtCountMap[b.bookId] ?? 0) > 0)
      .filter(b => !(b.bookId in bookReviewMap));
    if (candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, boolean> = {};
      const CONCURRENCY = 8;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        if (cancelled) return;
        const chunk = candidates.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map(async b => {
            const rv = await fetchBookReviews(b.bookId);
            const hasReview = (rv.reviews || []).some(r => r.review?.type === 4);
            return { id: b.bookId, hasReview };
          })
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            updates[r.value.id] = r.value.hasReview;
          }
        });
        if (cancelled) return;
        setBookReviewMap(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [visible, thoughtCountMap, bookReviewMap]);

  if (loading) return <div className="text-center py-20 text-gray-500">加载书架中...</div>;
  if (error) return (
    <div className="text-center py-20">
      <p className="text-red-500 mb-4">{error}</p>
      <button onClick={loadShelf} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">重试</button>
    </div>
  );

  return (
    <div>
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} category={category} onCategoryChange={setCategory} categories={categories} filteredCount={filtered.length} />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
        {visible.map(book => (
          <BookCard
            key={book.bookId}
            book={book}
            progress={progressMap[book.bookId]}
            noteCount={noteCountMap[book.bookId]}
            thoughtCount={thoughtCountMap[book.bookId]}
            hasBookReview={bookReviewMap[book.bookId]}
            onClick={() => onSelectBook(book)}
            onReviewClick={() => onSelectBook(book, { type: 'review-tab' })}
            onNoteClick={() => onSelectBook(book, { type: 'highlight' })}
            onThoughtClick={() => onSelectBook(book, { type: 'thought' })}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="text-center py-6 text-sm text-gray-400">加载中...</div>}
      {!hasMore && filtered.length > BATCH_SIZE && <div className="text-center py-6 text-sm text-gray-400">— 已显示全部 {filtered.length} 本 —</div>}
      {filtered.length === 0 && <div className="text-center py-20 text-gray-400">暂无书籍</div>}
    </div>
  );
}

function FinishedTab({ onSelectBook }: { onSelectBook: (book: BookItem, target?: HighlightTarget) => void }) {
  const [finishedBooks, setFinishedBooks] = useState<BookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);
  const [noteCountMap, setNoteCountMap] = useState<Record<string, number>>({});
  const [thoughtCountMap, setThoughtCountMap] = useState<Record<string, number>>({});
  const [bookReviewMap, setBookReviewMap] = useState<Record<string, boolean>>({});

  const loadFinished = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const notebooksData = await fetchAllNotebooks();
      const finishedNbs = notebooksData.books.filter(nb => nb.markedStatus === 4 && nb.book);
      const finished = finishedNbs.map(nb => nb.book as BookItem);
      setFinishedBooks(finished);
      const nm: Record<string, number> = {};
      const tm: Record<string, number> = {};
      finishedNbs.forEach(nb => {
        const id = nb.book!.bookId;
        nm[id] = nb.noteCount;
        tm[id] = nb.reviewCount;
      });
      setNoteCountMap(nm);
      setThoughtCountMap(tm);
      setLoading(false);


    } catch (err) {
      setError(err instanceof Error ? err.message : '加载已读完书架失败');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadFinished);
  }, [loadFinished]);

  const filtered = applyFilters(finishedBooks, b => b, keyword, category);
  const categories = collectCategories(finishedBooks);
  const visibleBooks = filtered.slice(0, displayCount);
  const hasMore = displayCount < filtered.length;
  const loadMore = useCallback(() => setDisplayCount(c => c + BATCH_SIZE), []);
  const sentinelRef = useInfiniteScroll(hasMore, loadMore, displayCount);

  // 增量扫描当前可见的书的书评（只扫描有想法的、未扫描过的）
  useEffect(() => {
    const candidates = visibleBooks
      .filter(b => (thoughtCountMap[b.bookId] ?? 0) > 0)
      .filter(b => !(b.bookId in bookReviewMap));
    if (candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates: Record<string, boolean> = {};
      const CONCURRENCY = 8;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        if (cancelled) return;
        const chunk = candidates.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map(async b => {
            const rv = await fetchBookReviews(b.bookId);
            const hasReview = (rv.reviews || []).some(r => r.review?.type === 4);
            return { id: b.bookId, hasReview };
          })
        );
        results.forEach(r => {
          if (r.status === 'fulfilled') {
            updates[r.value.id] = r.value.hasReview;
          }
        });
        if (cancelled) return;
        setBookReviewMap(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [visibleBooks, thoughtCountMap, bookReviewMap]);

  if (loading) return <div className="text-center py-20 text-gray-500">加载已读完书架中...</div>;
  if (error) return (
    <div className="text-center py-20">
      <p className="text-red-500 mb-4">{error}</p>
      <button onClick={loadFinished} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">重试</button>
    </div>
  );

  return (
    <div>
      <FilterBar keyword={keyword} onKeywordChange={setKeyword} category={category} onCategoryChange={setCategory} categories={categories} filteredCount={filtered.length} />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
        {visibleBooks.map(book => (
          <BookCard
            key={book.bookId}
            book={book}
            noteCount={noteCountMap[book.bookId]}
            thoughtCount={thoughtCountMap[book.bookId]}
            hasBookReview={bookReviewMap[book.bookId]}
            onClick={() => onSelectBook(book)}
            onReviewClick={() => onSelectBook(book, { type: 'review-tab' })}
            onNoteClick={() => onSelectBook(book, { type: 'highlight' })}
            onThoughtClick={() => onSelectBook(book, { type: 'thought' })}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="text-center py-6 text-sm text-gray-400">加载中...</div>}
      {!hasMore && filtered.length > BATCH_SIZE && <div className="text-center py-6 text-sm text-gray-400">— 已显示全部 {filtered.length} 本 —</div>}
      {filtered.length === 0 && <div className="text-center py-20 text-gray-400">暂无已读完书籍</div>}
    </div>
  );
}
