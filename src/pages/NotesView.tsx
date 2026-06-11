import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { BookItem, NotebookItem, BookmarkItem, ReviewItem } from '../types/weread';
import { fetchAllNotebooks, fetchBookmarks, fetchBookReviews } from '../services/weread';
import type { ChapterItem } from '../types/weread';
import { FilterBar } from '../utils/filters';
import { collectCategories, applyFilters, useInfiniteScroll } from '../utils/filterUtils';
import type { HighlightTarget } from '../App';
import { exportItemToImage } from '../utils/exportImage';
import { exportReviewToPdf } from '../utils/exportPdf';
import type { ExportStyleType } from '../App';
import exportImg from '../assets/export-img.png';
import exportPdf from '../assets/export-pdf.png';
import copyText from '../assets/copy-text.png';

interface NotesViewProps {
  selectedBook: BookItem | null;
  onBack: () => void;
  onSelectBook: (book: BookItem, target?: HighlightTarget) => void;
  highlightTarget?: HighlightTarget | null;
  exportStyle?: ExportStyleType;
  backLabel?: string;
}

export default function NotesView(props: NotesViewProps) {
  const { selectedBook, onBack, onSelectBook, highlightTarget } = props;
  void props.exportStyle; // suppress noUnusedLocals
  const [notebooks, setNotebooks] = useState<NotebookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [displayCount, setDisplayCount] = useState(30);
  const [exportingBookIds, setExportingBookIds] = useState<Set<string>>(new Set());

  const loadNotebooks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAllNotebooks();
      setNotebooks(data.books || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notebooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadNotebooks);
  }, [loadNotebooks]);

  const stripHtml = (html: string): string => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };


  const exportBookFromList = async (bookId: string, bookTitle: string, bookAuthor: string, bookCover: string) => {
    if (exportingBookIds.has(bookId)) return;
    setExportingBookIds(prev => new Set(prev).add(bookId));
    try {
      const [bmData, rvData] = await Promise.all([
        fetchBookmarks(bookId),
        fetchBookReviews(bookId),
      ]);
      const bookmarks = bmData.updated || [];
      const chapters = bmData.chapters || [];
      const reviews: ReviewItem[] = rvData.reviews || [];

      const bookReviews = reviews.filter(r => r.review.type === 4);
      const nonReviewThoughts = reviews.filter(r => r.review.type !== 4);
      const thoughtsByMark = new Map<string, ReviewItem[]>();
      nonReviewThoughts.forEach(rv => {
        const abs = rv.review.abstract?.trim() || '';
        if (abs) {
          const list = thoughtsByMark.get(abs) || [];
          list.push(rv);
          thoughtsByMark.set(abs, list);
        }
      });

      const chapterMap = new Map<number, string>();
      chapters.forEach(ch => chapterMap.set(ch.chapterUid, ch.title));

      const fmtTime = (ts: number) => {
        const d = new Date(ts * 1000);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
      };

      let highlightsHtml = '';
      let thoughtCount = 0;
      bookmarks.forEach((bm, idx) => {
        const markKey = bm.markText?.trim() || '';
        const related = thoughtsByMark.get(markKey) || [];
        const chapterName = chapterMap.get(bm.chapterUid) || '';
        thoughtCount += related.length;
        highlightsHtml += `<div class="item">
<div class="label">划线 ${idx + 1}</div>
${chapterName ? `<div class="chapter">${chapterName}</div>` : ''}
<div class="highlight-text">${bm.markText || ''}</div>
<div class="meta">${fmtTime(bm.createTime)}</div>`;
        related.forEach(t => {
          const content = t.review.htmlContent ? stripHtml(t.review.htmlContent) : (t.review.content || '');
          highlightsHtml += `<div class="thought">
<div class="label-inline">💭 想法</div>
<div class="thought-text">${content}</div>
<div class="meta">${fmtTime(t.review.createTime)}</div>
</div>`;
        });
        highlightsHtml += '</div>';
      });

      const linkedThoughtIds = new Set<string>();
      bookmarks.forEach(bm => {
        const key = bm.markText?.trim() || '';
        (thoughtsByMark.get(key) || []).forEach(rv => linkedThoughtIds.add(rv.review.reviewId));
      });
      const standaloneThoughts = nonReviewThoughts.filter(rv => !linkedThoughtIds.has(rv.review.reviewId));

      let thoughtsHtml = '';
      standaloneThoughts.forEach((rv, idx) => {
        const content = rv.review.htmlContent ? stripHtml(rv.review.htmlContent) : (rv.review.content || '');
        thoughtsHtml += `<div class="item">
<div class="label">想法 ${idx + 1}</div>
${rv.review.chapterName ? `<div class="chapter">${rv.review.chapterName}</div>` : ''}
<div class="thought-text">${content}</div>
<div class="meta">${fmtTime(rv.review.createTime)}</div>
</div>`;
      });

      let reviewsHtml = '';
      const sortedReviews = [...bookReviews].sort((a, b) => b.review.createTime - a.review.createTime);
      sortedReviews.forEach((rv, idx) => {
        const stars = Math.max(0, Math.min(5, Math.round((rv.review.star ?? 0) / 20)));
        const content = rv.review.htmlContent
          ? rv.review.htmlContent.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*"[^"]*"/gi, '').replace(/javascript:/gi, '')
          : (rv.review.content || '');
        reviewsHtml += `<div class="item">
<div class="label">书评 ${idx + 1}</div>
${stars > 0 ? `<div class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>` : ''}
${rv.review.chapterName ? `<div class="chapter">${rv.review.chapterName}</div>` : ''}
<div class="review-text">${content}</div>
<div class="meta">${fmtTime(rv.review.createTime)}</div>
${(rv.likesCount ?? 0) > 0 ? `<div class="meta likes">❤️ ${rv.likesCount}</div>` : ''}
</div>`;
      });

      const coverUrl = bookCover
        ? (bookCover.startsWith('http') ? bookCover : 'https://weread-1258476243.file.myqcloud.com' + bookCover)
        : '';

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${bookTitle}-笔记成书</title>
<style>@page{margin:2cm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Noto Serif SC','Source Han Serif SC','Songti SC','SimSun',serif;font-size:14px;line-height:1.9;color:#222;padding:20px;max-width:800px;margin:0 auto}.book-header{text-align:center;margin-bottom:36px;padding-bottom:24px;border-bottom:2px solid #e0e0e0}.book-header .cover{width:120px;height:168px;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.1);margin:0 auto 16px}.book-header .cover img{width:100%;height:100%;object-fit:cover}.book-header h1{font-size:22px;font-weight:700;margin-bottom:6px}.book-header .author{font-size:14px;color:#666}.book-header .stats{margin-top:12px;font-size:13px;color:#888}.section-title{font-size:16px;font-weight:700;color:#333;margin:32px 0 16px;padding-bottom:8px;border-bottom:1px solid #e8e8e8}.item{margin-bottom:24px;padding-bottom:16px;border-bottom:1px dashed #eee}.item:last-child{border-bottom:none}.label{font-size:12px;color:#999;margin-bottom:4px;letter-spacing:1px}.label-inline{font-size:12px;color:#8b5cf6;margin:10px 0 4px}.chapter{font-size:12px;color:#aaa;margin-bottom:6px}.highlight-text{font-size:15px;color:#333;background:#fff9db;padding:8px 12px;border-radius:4px;border-left:3px solid #e8b61f;margin-bottom:6px;word-break:break-word;white-space:pre-wrap}.thought-text{font-size:14px;color:#555;font-style:italic;padding-left:12px;border-left:2px solid #c4b5fd;word-break:break-word;white-space:pre-wrap}.review-text{font-size:14px;color:#444;line-height:1.9;word-break:break-word;white-space:pre-wrap}.review-text p{margin-bottom:.6em}.stars{font-size:15px;color:#e8b61f;margin-bottom:6px}.meta{font-size:12px;color:#bbb;margin-top:4px}.meta.likes{color:#e8878a}.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e0e0e0;text-align:center;font-size:11px;color:#ccc;letter-spacing:2px}@media print{body{padding:0}.item{page-break-inside:avoid}}</style>
</head>
<body>
<div class="book-header">
${coverUrl ? `<div class="cover"><img src="${coverUrl}" /></div>` : ''}
<h1>笔记成书</h1>
<h2 style="font-size:18px;font-weight:400;margin-top:4px">《${bookTitle}》</h2>
<p class="author">${bookAuthor}</p>
<p class="stats">${bookmarks.length} 条划线 · ${thoughtCount + standaloneThoughts.length} 条想法 · ${sortedReviews.length} 篇书评</p>
</div>
${highlightsHtml ? `<div class="section-title">📍 划线与想法</div>${highlightsHtml}` : ''}
${thoughtsHtml ? `<div class="section-title">💭 未关联想法</div>${thoughtsHtml}` : ''}
${reviewsHtml ? `<div class="section-title">⭐ 书评</div>${reviewsHtml}` : ''}
<div class="footer">由 微痕 导出 · 笔记成书</div>
<script>document.title='${bookTitle}-笔记成书';window.onload=function(){window.print()};</script>
</body>
</html>`;

      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:99999;';
      iframe.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      document.body.appendChild(iframe);
      const cleanup = () => {
        URL.revokeObjectURL(iframe.src);
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      };
      iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 600000);
    } finally {
      setExportingBookIds(prev => {
        const next = new Set(prev);
        next.delete(bookId);
        return next;
      });
    }
  };

  const categories = useMemo(
    () => collectCategories(notebooks.map(n => n.book).filter(Boolean) as BookItem[]),
    [notebooks]
  );
  const filtered = useMemo(
    () => applyFilters(notebooks.filter(n => n.book), n => n.book as BookItem, keyword, category),
    [notebooks, keyword, category]
  );

  const updateKeyword = useCallback((value: string) => {
    setKeyword(value);
    setDisplayCount(30);
  }, []);

  const updateCategory = useCallback((value: string) => {
    setCategory(value);
    setDisplayCount(30);
  }, []);

  const total = filtered.length;
  const hasMore = displayCount < total;
  const sentinelRef = useInfiniteScroll(hasMore, () => setDisplayCount(c => c + 30), displayCount);

  if (loading) {
    return <div className="text-center py-20 text-gray-500">加载笔记中...</div>;
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={loadNotebooks}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          重试
        </button>
      </div>
    );
  }

  if (selectedBook) {
    return (
      <BookNotesDetail
        exportStyle={props.exportStyle}
        backLabel={props.backLabel}
        book={selectedBook}
        onBack={() => onBack()}
        highlightTarget={highlightTarget}
      />
    );
  }

  const visible = filtered.slice(0, displayCount);

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-4 mb-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">我的笔记</h2>
            <p className="text-sm text-gray-500 mt-1">
              {filtered.length === notebooks.length
                ? `${notebooks.length} 本有笔记的书`
                : `${filtered.length} / ${notebooks.length} 本`}
            </p>
          </div>
          <div className="text-xs sm:text-sm text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1 sm:justify-end">
            <span>{filtered.reduce((sum, b) => sum + b.noteCount, 0)} 条笔记</span>
            <span className="text-purple-600">💭 {filtered.reduce((sum, b) => sum + b.reviewCount, 0)} 想法</span>
          </div>
        </div>
      </div>

      <FilterBar
        keyword={keyword}
        onKeywordChange={updateKeyword}
        category={category}
        onCategoryChange={updateCategory}
        categories={categories}
        filteredCount={total}
      />

      {visible.length === 0 ? (
        <div className="text-center py-20 text-gray-400">没有匹配的书籍</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {visible.map(book => {
            return (
              <button
                key={book.bookId}
                onClick={() => {
                  onSelectBook(book.book as BookItem);
                }}
                className="h-full text-left bg-white rounded-2xl border border-gray-100 p-4 sm:p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{book.book?.title || '未知'}</h3>
                    <p className="text-sm text-gray-500 truncate mt-0.5">{book.book?.author}</p>
                  </div>
                  {book.readingProgress > 0 && (
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">
                      {book.readingProgress}%
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-gray-50">
                  <span className="flex items-center gap-1 text-xs text-blue-600">
                    📍 {book.noteCount} 划线
                  </span>
                  <span className="flex items-center gap-1 text-xs text-purple-600">
                    💭 {book.reviewCount} 想法
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      if (exportingBookIds.has(book.bookId)) return;
                      exportBookFromList(book.bookId, book.book?.title || '未知', book.book?.author || '', book.book?.cover || '');
                    }}
                    role="button"
                    tabIndex={0}
                    className="ml-auto px-2 py-1 rounded text-xs font-medium transition-all hover:scale-110 cursor-pointer select-none"
                    style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)', opacity: exportingBookIds.has(book.bookId) ? 0.5 : 1 }}
                    title="笔记成书"
                  >
                    {exportingBookIds.has(book.bookId) ? '⏳' : '📚 成书'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="text-center py-6 text-sm text-gray-400">
          加载中...
        </div>
      )}
      {!hasMore && total > 30 && (
        <div className="text-center py-6 text-sm text-gray-400">— 已显示全部 {total} 本 —</div>
      )}
    </div>
  );
}

function BookNotesDetail({ book, onBack, highlightTarget, exportStyle, backLabel }: { book: BookItem; onBack: () => void; highlightTarget?: HighlightTarget | null; exportStyle?: ExportStyleType; backLabel?: string }) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [chapters, setChapters] = useState<ChapterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingBook, setExportingBook] = useState(false);

  useEffect(() => {
    const loadDetails = async () => {
      try {
        const [bmData, rvData] = await Promise.all([
          fetchBookmarks(book.bookId),
          fetchBookReviews(book.bookId),
        ]);
        setBookmarks(bmData.updated || []);
        setChapters(bmData.chapters || []);
        setReviews(rvData.reviews || []);
      } catch (err) {
        console.error('加载书籍详情失败：', err);
      } finally {
        setLoading(false);
      }
    };
    loadDetails();
  }, [book.bookId]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const formatChineseDate = (timestamp: number) => {
    const d = new Date(timestamp * 1000);
    return `写于${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日${d.getHours()}点${String(d.getMinutes()).padStart(2, '0')}分`;
  };

  const stripHtml = (html: string): string => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  };

  const exportBookToPDF = async () => {
    if (exportingBook) return;
    setExportingBook(true);
    try {
      const bookReviews = reviews.filter(r => r.review.type === 4);
      const nonReviewThoughts = reviews.filter(r => r.review.type !== 4);
      const thoughtsByMark = new Map<string, ReviewItem[]>();
      nonReviewThoughts.forEach(rv => {
        const abs = rv.review.abstract?.trim() || '';
        if (abs) {
          const list = thoughtsByMark.get(abs) || [];
          list.push(rv);
          thoughtsByMark.set(abs, list);
        }
      });

      const chapterMap = new Map<number, string>();
      chapters.forEach(ch => chapterMap.set(ch.chapterUid, ch.title));

      const fmtTime = (ts: number) => {
        const d = new Date(ts * 1000);
        return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
      };

      // Build HTML sections
      let highlightsHtml = '';
      let thoughtCount = 0;
      bookmarks.forEach((bm, idx) => {
        const markKey = bm.markText?.trim() || '';
        const related = thoughtsByMark.get(markKey) || [];
        const chapterName = chapterMap.get(bm.chapterUid) || '';
        thoughtCount += related.length;

        highlightsHtml += `<div class="item">
<div class="label">划线 ${idx + 1}</div>
${chapterName ? `<div class="chapter">${chapterName}</div>` : ''}
<div class="highlight-text">${bm.markText || ''}</div>
<div class="meta">${fmtTime(bm.createTime)}</div>`;

        related.forEach(t => {
          const content = t.review.htmlContent
            ? stripHtml(t.review.htmlContent)
            : (t.review.content || '');
          highlightsHtml += `<div class="thought">
<div class="label-inline">💭 想法</div>
<div class="thought-text">${content}</div>
<div class="meta">${fmtTime(t.review.createTime)}</div>
</div>`;
        });
        highlightsHtml += '</div>';
      });

      // Standalone thoughts (not linked to any highlight)
      const linkedThoughtIds = new Set<string>();
      bookmarks.forEach(bm => {
        const key = bm.markText?.trim() || '';
        const related = thoughtsByMark.get(key) || [];
        related.forEach(rv => linkedThoughtIds.add(rv.review.reviewId));
      });
      const standaloneThoughts = nonReviewThoughts.filter(rv => !linkedThoughtIds.has(rv.review.reviewId));

      let thoughtsHtml = '';
      standaloneThoughts.forEach((rv, idx) => {
        const content = rv.review.htmlContent
          ? stripHtml(rv.review.htmlContent)
          : (rv.review.content || '');
        thoughtsHtml += `<div class="item">
<div class="label">想法 ${idx + 1}</div>
${rv.review.chapterName ? `<div class="chapter">${rv.review.chapterName}</div>` : ''}
<div class="thought-text">${content}</div>
<div class="meta">${fmtTime(rv.review.createTime)}</div>
</div>`;
      });

      // Book reviews
      let reviewsHtml = '';
      const sortedReviews = [...bookReviews].sort((a, b) => b.review.createTime - a.review.createTime);
      sortedReviews.forEach((rv, idx) => {
        const stars = Math.max(0, Math.min(5, Math.round((rv.review.star ?? 0) / 20)));
        const content = rv.review.htmlContent
          ? rv.review.htmlContent
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
              .replace(/javascript:/gi, '')
          : (rv.review.content || '');
        reviewsHtml += `<div class="item">
<div class="label">书评 ${idx + 1}</div>
${stars > 0 ? `<div class="stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</div>` : ''}
${rv.review.chapterName ? `<div class="chapter">${rv.review.chapterName}</div>` : ''}
<div class="review-text">${content}</div>
<div class="meta">${fmtTime(rv.review.createTime)}</div>
${(rv.likesCount ?? 0) > 0 ? `<div class="meta likes">❤️ ${rv.likesCount}</div>` : ''}
</div>`;
      });

      const coverUrl = book.cover
        ? (book.cover.startsWith('http') ? book.cover : 'https://weread-1258476243.file.myqcloud.com' + book.cover)
        : '';

      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${book.title}-笔记成书</title>
<style>
  @page { margin: 2cm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
    font-size: 14px;
    line-height: 1.9;
    color: #222;
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
  }
  .book-header {
    text-align: center;
    margin-bottom: 36px;
    padding-bottom: 24px;
    border-bottom: 2px solid #e0e0e0;
  }
  .book-header .cover {
    width: 120px;
    height: 168px;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    margin: 0 auto 16px;
  }
  .book-header .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .book-header h1 {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .book-header .author {
    font-size: 14px;
    color: #666;
  }
  .book-header .stats {
    margin-top: 12px;
    font-size: 13px;
    color: #888;
  }
  .section-title {
    font-size: 16px;
    font-weight: 700;
    color: #333;
    margin: 32px 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #e8e8e8;
  }
  .item {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px dashed #eee;
  }
  .item:last-child { border-bottom: none; }
  .label {
    font-size: 12px;
    color: #999;
    margin-bottom: 4px;
    letter-spacing: 1px;
  }
  .label-inline {
    font-size: 12px;
    color: #8b5cf6;
    margin: 10px 0 4px;
  }
  .chapter {
    font-size: 12px;
    color: #aaa;
    margin-bottom: 6px;
  }
  .highlight-text {
    font-size: 15px;
    color: #333;
    background: #fff9db;
    padding: 8px 12px;
    border-radius: 4px;
    border-left: 3px solid #e8b61f;
    margin-bottom: 6px;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .thought-text {
    font-size: 14px;
    color: #555;
    font-style: italic;
    padding-left: 12px;
    border-left: 2px solid #c4b5fd;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .review-text {
    font-size: 14px;
    color: #444;
    line-height: 1.9;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .review-text p { margin-bottom: 0.6em; }
  .stars {
    font-size: 15px;
    color: #e8b61f;
    margin-bottom: 6px;
  }
  .meta {
    font-size: 12px;
    color: #bbb;
    margin-top: 4px;
  }
  .meta.likes { color: #e8878a; }
  .footer {
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #e0e0e0;
    text-align: center;
    font-size: 11px;
    color: #ccc;
    letter-spacing: 2px;
  }
  @media print {
    body { padding: 0; }
    .item { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="book-header">
  ${coverUrl ? `<div class="cover"><img src="${coverUrl}" /></div>` : ''}
  <h1>笔记成书</h1>
  <h2 style="font-size:18px;font-weight:400;margin-top:4px">《${book.title}》</h2>
  <p class="author">${book.author}</p>
  <p class="stats">${bookmarks.length} 条划线 · ${thoughtCount + standaloneThoughts.length} 条想法 · ${sortedReviews.length} 篇书评</p>
</div>
${highlightsHtml ? `<div class="section-title">📍 划线与想法</div>${highlightsHtml}` : ''}
${thoughtsHtml ? `<div class="section-title">💭 未关联想法</div>${thoughtsHtml}` : ''}
${reviewsHtml ? `<div class="section-title">⭐ 书评</div>${reviewsHtml}` : ''}
<div class="footer">由 微痕 导出 · 笔记成书</div>
<script>document.title='${book.title}-笔记成书';window.onload=function(){window.print()};</script>
</body>
</html>`;

      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:99999;';
      iframe.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      document.body.appendChild(iframe);

      const cleanup = () => {
        URL.revokeObjectURL(iframe.src);
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      };
      iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 600000);
    } finally {
      setExportingBook(false);
    }
  };

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-6 text-blue-600 hover:text-blue-700 flex items-center gap-2 text-sm font-medium"
      >
        ← {backLabel || '返回笔记列表'}
      </button>

      <div className="mb-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📖</span>
            <div>
              <h3 className="text-xl font-bold text-gray-900">{book.title}</h3>
              <p className="text-gray-500">{book.author}</p>
            </div>
          </div>
          <button
            onClick={exportBookToPDF}
            disabled={exportingBook || loading}
            className="relative group flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              color: 'var(--text-muted)',
              backgroundColor: 'var(--bg-tertiary)',
            }}
            title="笔记成书 — 导出整本书的划线、想法和书评汇总为 PDF"
          >
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap text-xs px-2 py-1 rounded shadow-md pointer-events-none"
              style={{ color: '#fff', backgroundColor: '#333' }}>
              笔记成书
            </span>
            {exportingBook ? '⏳' : '📘'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">加载笔记中...</div>
      ) : (
        <NotesContent
          book={book}
          bookmarks={bookmarks}
          reviews={reviews}
          formatDate={formatDate}
          formatChineseDate={formatChineseDate}
          highlightTarget={highlightTarget}
          exportStyle={exportStyle}
        />
      )}
    </div>
  );
}

interface NotesContentProps {
  book: BookItem;
  bookmarks: BookmarkItem[];
  reviews: ReviewItem[];
  formatDate: (timestamp: number) => string;
  formatChineseDate: (timestamp: number) => string;
  highlightTarget?: HighlightTarget | null;
  exportStyle?: ExportStyleType;
  backLabel?: string;
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

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function ThoughtContent({ review, className }: { review: ReviewItem['review']; className?: string }) {
  if (review.htmlContent) {
    return (
      <div
        className={`thought-html ${className || ''}`}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(review.htmlContent) }}
      />
    );
  }
  return <p className={`whitespace-pre-wrap ${className || ''}`}>{review.content}</p>;
}

type DetailTab = 'bookmarks' | 'reviews';
type BookmarkFilter = 'with-thoughts' | 'all';

function NotesContent({ book, bookmarks, reviews, formatDate, formatChineseDate, highlightTarget, exportStyle }: NotesContentProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>(() => {
    if (highlightTarget?.type === 'review-tab') return 'reviews';
    return 'bookmarks';
  });
  const [bookmarkFilter, setBookmarkFilter] = useState<BookmarkFilter>('with-thoughts');
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportingReviewId, setExportingReviewId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const highlightIdRef = useRef<string | null>(null);
  const highlightKwRef = useRef<string | null>(null);
  const handledTargetRef = useRef<HighlightTarget | null>(null);

  const bookReviews = reviews.filter(r => r.review.type === 4);
  const nonReviewThoughts = reviews.filter(r => r.review.type !== 4);

  // 按划线内容关联想法：review.abstract === bookmark.markText（仅非书评想法参与关联）
  const thoughtsByMark = new Map<string, ReviewItem[]>();

  nonReviewThoughts.forEach(rv => {
    const abs = rv.review.abstract?.trim();
    if (abs) {
      const list = thoughtsByMark.get(abs) || [];
      list.push(rv);
      thoughtsByMark.set(abs, list);
    }
  });

  const items = bookmarks.map(bm => {
    const key = bm.markText?.trim() || '';
    const related = thoughtsByMark.get(key) || [];
    return { bookmark: bm, thoughts: related };
  });

  const displayItems = bookmarkFilter === 'with-thoughts'
    ? items.filter(item => item.thoughts.length > 0)
    : items;

  const sortedBookReviews = [...bookReviews].sort((a, b) => b.review.createTime - a.review.createTime);

  // 处理来自搜索结果的高亮目标：切 tab、展开全部、滚动 + 临时高亮（仅在 target 变化时处理一次）
  useEffect(() => {
    if (!highlightTarget) return;
    if (handledTargetRef.current === highlightTarget) return;
    handledTargetRef.current = highlightTarget;
    highlightIdRef.current = highlightTarget.id ?? null;
    highlightKwRef.current = highlightTarget.keyword || null;

    const isBookReview = highlightTarget.type === 'thought' &&
      bookReviews.some(r => r.review.reviewId === highlightTarget.id);
    const nextTab: DetailTab = highlightTarget.type === 'review-tab' || isBookReview
      ? 'reviews'
      : 'bookmarks';
    const timer = window.setTimeout(() => {
      setActiveTab(nextTab);
      if (nextTab === 'bookmarks') {
        setBookmarkFilter('all');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [highlightTarget, bookReviews]);

  useEffect(() => {
    if (!highlightIdRef.current) return;
    const id = highlightIdRef.current;
    const t = setTimeout(() => {
      const el = document.getElementById(`target-${id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-yellow-400', 'bg-yellow-50');
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-yellow-400', 'bg-yellow-50');
        }, 3000);
        highlightIdRef.current = null;
      }
    }, 200);
    return () => clearTimeout(t);
  }, [activeTab, bookmarkFilter, bookmarks, reviews]);

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'bookmarks', label: '划线与想法' },
    { key: 'reviews', label: '书评' },
  ];

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'bookmarks' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center gap-3 mb-6">
            <span className="text-lg">📍</span>
            <button
              onClick={() => setBookmarkFilter('all')}
              className={`text-lg font-semibold transition-colors ${
                bookmarkFilter === 'all'
                  ? 'text-blue-600 underline underline-offset-4 decoration-2'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              划线 {bookmarks.length}
            </button>
            <span className="text-gray-300">·</span>
            <button
              onClick={() => setBookmarkFilter('with-thoughts')}
              className={`text-base font-semibold transition-colors ${
                bookmarkFilter === 'with-thoughts'
                  ? 'text-blue-600 underline underline-offset-4 decoration-2'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              想法 {nonReviewThoughts.length}
            </button>
          </div>
          <div className="space-y-5">
            {displayItems.map(({ bookmark, thoughts }) => (
              <div key={bookmark.bookmarkId} id={`target-${bookmark.bookmarkId}`} className="group relative rounded-xl transition-colors hover:bg-gray-50/50 -mx-2 px-2 py-2">
                <div className="border-l-4 border-blue-500 pl-4 py-2">
                  <p className="text-gray-700 leading-relaxed">"{bookmark.markText}"</p>
                  <p className="text-xs text-gray-400 mt-2 flex items-center gap-2">
                    <span>⏱</span>
                    <span>{formatDate(bookmark.createTime)}</span>
                  </p>
                </div>
                {thoughts.length > 0 && (
                  <div className="mt-3 ml-6 space-y-2">
                    {thoughts.map(rv => (
                      <div
                        key={rv.review.reviewId}
                        id={`target-${rv.review.reviewId}`}
                        className="border-l-2 border-purple-300 bg-purple-50/40 rounded-r-lg pl-3 pr-3 py-2"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-purple-500 text-xs mt-0.5">💭</span>
                          <ThoughtContent
                            review={rv.review}
                            className="text-gray-700 text-sm leading-relaxed flex-1"
                          />
                        </div>
                        {rv.review.star > 0 && (
                          <p className="text-yellow-500 text-xs mt-1 ml-5">
                            {'★'.repeat(Math.max(0, Math.min(5, Math.round(rv.review.star / 20))))}
                          </p>
                        )}
                        <p className="text-[10px] text-gray-400 mt-1 ml-5 flex items-center gap-2">
                          <span className="flex items-center gap-1">
                            <span>⏱</span>
                            <span>{formatDate(rv.review.createTime)}</span>
                          </span>
                          {(rv.likesCount ?? 0) > 0 && (
                            <span className="flex items-center gap-0.5 text-red-400">
                              ❤️ {rv.likesCount}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={async () => {
                      let textToCopy = `${bookmark.markText || ''}`;
                      if (thoughts.length > 0) {
                        textToCopy += '\n\n';
                        thoughts.forEach((rv, idx) => {
                          const thoughtText = rv.review.content || stripHtml(rv.review.htmlContent || '');
                          textToCopy += `${thoughtText}`;
                          if (idx < thoughts.length - 1) textToCopy += '\n';
                        });
                      }
                      await copyToClipboard(textToCopy);
                      setCopiedId(bookmark.bookmarkId);
                      setTimeout(() => setCopiedId(null), 1500);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all hover:scale-110"
                    style={{
                      backgroundColor: copiedId === bookmark.bookmarkId ? 'rgba(46,204,113,0.15)' : 'var(--bg-tertiary)',
                      color: copiedId === bookmark.bookmarkId ? '#2ecc71' : 'var(--text-muted)',
                    }}
                    title={copiedId === bookmark.bookmarkId ? '已复制 ✓' : '复制文本'}
                  >{copiedId === bookmark.bookmarkId ? '✓' : <img src={copyText} alt="" className="w-3.5 h-3.5 object-contain" />}</button>
                  <button
                    onClick={async () => {
                      setExportingId(bookmark.bookmarkId);
                      try {
                        const thoughtEntries = thoughts.map(rv => ({
                          content: rv.review.content || stripHtml(rv.review.htmlContent || ''),
                          time: formatDate(rv.review.createTime),
                          likesCount: rv.likesCount,
                          stars: Math.max(0, Math.min(5, Math.round((rv.review.star ?? 0) / 20))),
                        }));
                        await exportItemToImage({
                          bookTitle: book.title || '',
                          bookAuthor: book.author || '',
                          bookCover: book.cover,
                          type: 'highlight',
                          content: bookmark.markText || '',
                          time: formatDate(bookmark.createTime),
                          thoughts: thoughtEntries.length > 0 ? thoughtEntries : undefined,
                          style: exportStyle,
                        });
                      } finally {
                        setExportingId(null);
                      }
                    }}
                    disabled={exportingId === bookmark.bookmarkId}
                    className="w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all hover:scale-110 disabled:cursor-wait"
                    style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
                    title={exportingId === bookmark.bookmarkId ? '生成中...' : '导出图片'}
                  >{exportingId === bookmark.bookmarkId ? '⏳' : <span className="w-3.5 h-3.5 block" style={{ backgroundImage: `url(${exportImg})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />}</button>
                </div>
              </div>
            ))}
            {displayItems.length === 0 && (
              <p className="text-gray-400 text-sm text-center py-8">
                {bookmarkFilter === 'with-thoughts'
                  ? (bookmarks.length === 0 ? '暂无划线' : '没有含想法的划线')
                  : '暂无划线'}
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'reviews' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-6 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <span className="text-lg">⭐</span>
              <h4 className="font-semibold text-lg">《{book.title}》的书评</h4>
            </div>
            {sortedBookReviews.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const text = sortedBookReviews.map(rv => rv.review.content || stripHtml(rv.review.htmlContent || '')).filter(Boolean).join('\n\n---\n\n');
                    void copyToClipboard(text);
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all hover:scale-110"
                  style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
                  title="复制文本"
                ><img src={copyText} alt="" className="w-4 h-4 object-contain" /></button>
                <button
                  onClick={async () => {
                    setExportingReviewId('_all_');
                    try {
                      for (const rv of sortedBookReviews) {
                        await exportItemToImage({
                          bookTitle: book.title || '',
                          bookAuthor: book.author || '',
                          bookCover: book.cover,
                          type: 'review',
                          htmlContent: rv.review.htmlContent,
                          content: rv.review.content || stripHtml(rv.review.htmlContent || ''),
                          time: formatDate(rv.review.createTime),
                          chapterName: rv.review.chapterName,
                          likesCount: rv.likesCount,
                          stars: Math.max(0, Math.min(5, Math.round((rv.review.star ?? 0) / 20))),
                          style: exportStyle,
                        });
                      }
                    } finally {
                      setExportingReviewId(null);
                    }
                  }}
                  disabled={exportingReviewId === '_all_'}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all hover:scale-110 disabled:cursor-wait"
                  style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
                  title={exportingReviewId === '_all_' ? '生成中...' : '导出图片'}
                >{exportingReviewId === '_all_' ? '⏳' : <span className="w-4 h-4 block" style={{ backgroundImage: `url(${exportImg})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }} />}</button>
                <button
                  onClick={() => exportReviewToPdf({
                    bookTitle: book.title || '',
                    bookAuthor: book.author || '',
                    bookCover: book.cover,
                    stars: Math.max(0, Math.min(5, Math.round((sortedBookReviews[0]?.review.star ?? 0) / 20))),
                    createTime: formatDate(sortedBookReviews[0]?.review.createTime || 0),
                    likesCount: sortedBookReviews[0]?.likesCount,
                    htmlContent: sortedBookReviews.map(rv => rv.review.htmlContent).filter(Boolean).join('<hr>'),
                    textContent: sortedBookReviews.map(rv => rv.review.content).filter(Boolean).join(' | '),
                  })}
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-sm transition-all hover:scale-110"
                  style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-tertiary)' }}
                  title="导出PDF"
                ><img src={exportPdf} alt="PDF" className="w-4 h-4 object-contain" /></button>
              </div>
            )}
          </div>
          {sortedBookReviews.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">暂无书评</p>
          ) : (
            <div className="space-y-4">
              {sortedBookReviews.map(rv => (
                <div key={rv.review.reviewId} id={`target-${rv.review.reviewId}`}>
                  <div className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition-colors">
                    <ThoughtContent review={rv.review} className="text-gray-700 leading-relaxed" />
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>{formatChineseDate(rv.review.createTime)}</span>
                        {rv.review.chapterName && <span>· {rv.review.chapterName}</span>}
                        {(rv.likesCount ?? 0) > 0 && (
                          <span className="text-red-400">❤️ {rv.likesCount}</span>
                        )}
                      </div>
                    {(() => {
                      const stars = Math.max(0, Math.min(5, Math.round((rv.review.star ?? 0) / 20)));
                      return stars > 0 ? (
                        <span className="text-yellow-500 text-sm">{'★'.repeat(stars)}{'☆'.repeat(5 - stars)}</span>
                      ) : null;
                    })()}
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
