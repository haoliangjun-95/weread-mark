import { useState, useCallback, useRef, useEffect } from 'react';
import { fetchAllNotebooks, fetchBookmarks, fetchBookReviews, getApiKey } from '../services/weread';
import type { BookItem, NotebookItem } from '../types/weread';
import copyText from '../assets/copy-text.png';
import type { HighlightTarget } from '../App';

type SearchResultType = 'highlight' | 'thought';

interface SearchResult {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  type: SearchResultType;
  content: string;
  highlight: string;
  htmlHighlight?: string;
  createTime: number;
  chapterName?: string;
  targetId: string;
  book: BookItem;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightKeyword(text: string, keyword: string): string {
  const safe = escapeHtml(text).replace(/\n/g, '<br>');
  if (!keyword.trim()) return safe;
  const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return safe.replace(regex, '<mark class="bg-yellow-200 text-gray-900 px-0.5 rounded">$1</mark>');
}

/** 在保留 HTML 标签的同时高亮关键词（用于 htmlContent 等富文本） */
function highlightKeywordInHtml(html: string, keyword: string): string {
  if (!keyword.trim()) return html;
  const escapedKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 只对标签外的文本节点做高亮
  return html.replace(/>([^<]*)</g, (_full, text) => {
    const highlighted = text.replace(
      new RegExp(`(${escapedKw})`, 'gi'),
      '<mark class="bg-yellow-200 text-gray-900 px-0.5 rounded">$1</mark>',
    );
    return `>${highlighted}<`;
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
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
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

interface SearchViewProps {
  onSelectBook: (book: BookItem, target?: HighlightTarget) => void;
}

export default function SearchView({ onSelectBook }: SearchViewProps) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [hasKey, setHasKey] = useState(() => !!getApiKey());
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const notebooksCacheRef = useRef<NotebookItem[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onStorage = () => setHasKey(!!getApiKey());
    window.addEventListener('storage', onStorage);
    const id = setInterval(onStorage, 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(id);
    };
  }, []);

  const stopSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleSearch = useCallback(async (query?: string) => {
    const kw = (query ?? keyword).trim();
    if (!kw) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    setSearched(true);
    setResults([]);
    setProgress({ done: 0, total: 0 });

    try {
      let books = notebooksCacheRef.current;
      if (!books) {
        const notebooksData = await fetchAllNotebooks();
        books = notebooksData.books;
        notebooksCacheRef.current = books;
      }

      if (ac.signal.aborted) return;

      const lowerKw = kw.toLowerCase();
      const booksWithContent = books.filter(
        nb => (nb.noteCount > 0 || nb.reviewCount > 0) && nb.book?.bookId
      );

      setProgress({ done: 0, total: booksWithContent.length });

      const collected: SearchResult[] = [];
      const pushAndRender = (batch: SearchResult[]) => {
        if (batch.length === 0 || ac.signal.aborted) return;
        collected.push(...batch);
        collected.sort((a, b) => b.createTime - a.createTime);
        setResults([...collected]);
      };

      const CONCURRENCY = 10;
      for (let i = 0; i < booksWithContent.length; i += CONCURRENCY) {
        if (ac.signal.aborted) return;
        const chunk = booksWithContent.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map(async (nb) => {
            const bookId = nb.book!.bookId;
            const title = nb.book!.title || 'Unknown';
            const author = nb.book!.author || '';
            const local: SearchResult[] = [];

            try {
              const [bmData, rvData] = await Promise.all([
                fetchBookmarks(bookId, ac.signal),
                fetchBookReviews(bookId, 0, ac.signal),
              ]);

              (bmData.updated || []).forEach((bm) => {
                if (bm.markText?.toLowerCase().includes(lowerKw)) {
                  local.push({
                    bookId,
                    bookTitle: title,
                    bookAuthor: author,
                    type: 'highlight',
                    content: bm.markText,
                    highlight: highlightKeyword(bm.markText, kw),
                    createTime: bm.createTime,
                    chapterName: bm.chapterUid?.toString(),
                    targetId: bm.bookmarkId,
                    book: nb.book as BookItem,
                  });
                }
              });

              (rvData.reviews || []).forEach((rv) => {
                if (rv.review.content?.toLowerCase().includes(lowerKw)) {
                  const htmlHighlight = rv.review.htmlContent
                    ? highlightKeywordInHtml(rv.review.htmlContent, kw)
                    : undefined;
                  local.push({
                    bookId,
                    bookTitle: title,
                    bookAuthor: author,
                    type: 'thought',
                    content: rv.review.content,
                    highlight: highlightKeyword(rv.review.content, kw),
                    htmlHighlight,
                    createTime: rv.review.createTime,
                    chapterName: rv.review.chapterName,
                    targetId: rv.review.reviewId,
                    book: nb.book as BookItem,
                  });
                }
              });
            } catch {
              if (ac.signal.aborted) return local;
            }
            return local;
          })
        );
        if (ac.signal.aborted) return;
        const flat = chunkResults.flat();
        pushAndRender(flat);
        setProgress({ done: Math.min(i + CONCURRENCY, booksWithContent.length), total: booksWithContent.length });
      }
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : '搜索失败');
    } finally {
      if (!ac.signal.aborted) {
        setLoading(false);
      }
    }
  }, [keyword]);

  const typeBadge = (type: SearchResultType) => {
    switch (type) {
      case 'highlight':
        return <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">划线</span>;
      case 'thought':
        return <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">想法</span>;
    }
  };

  return (
    <div>
      <div className="mb-5 sm:mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1 sm:mb-2">搜索</h2>
        <p className="text-sm text-gray-500">在划线、想法中查找内容</p>
      </div>

      <div className="flex gap-2 sm:gap-3 mb-6 sm:mb-8">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="输入关键词搜索划线或想法"
          className="flex-1 min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
        />
        {loading ? (
          <button
            onClick={stopSearch}
            className="flex-shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 bg-gray-500 text-white rounded-xl hover:bg-gray-600 transition-colors text-sm sm:text-base"
          >
            停止
          </button>
        ) : (
          <button
            onClick={() => handleSearch()}
            disabled={!keyword.trim() || !hasKey}
            title={!hasKey ? '请先设置 API Key' : ''}
            className="flex-shrink-0 px-4 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
          >
            搜索
          </button>
        )}
      </div>

      {error && (
        <div className="text-center py-10">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => handleSearch()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      )}

      {loading && progress.total > 0 && results.length === 0 && (
        <div className="text-center py-20 text-gray-500">
          正在搜索... {progress.done}/{progress.total} 本书
        </div>
      )}

      {loading && results.length > 0 && (
        <div className="text-center text-sm text-gray-400 mb-4">
          搜索中 {progress.done}/{progress.total}，已找到 {results.length} 条
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="text-center py-20">
          <span className="text-4xl mb-4 block">🔍</span>
          <p className="text-gray-500">未找到包含 "{keyword}" 的内容</p>
        </div>
      )}

      {results.length > 0 && (
        <div>
          {!loading && (
            <p className="text-sm text-gray-500 mb-4">找到 {results.length} 条结果</p>
          )}
          <div className="space-y-4">
            {results.map((result, idx) => (
              <button
                key={`note-${idx}`}
                onClick={() => onSelectBook(result.book, { type: result.type, id: result.targetId, keyword })}
                className="w-full text-left bg-white border border-gray-100 rounded-2xl p-4 sm:p-5 hover:shadow-md hover:-translate-y-0.5 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-gray-900 truncate">{result.bookTitle}</p>
                    <p className="text-xs text-gray-500 truncate">{result.bookAuthor}</p>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 ml-2 sm:ml-3 shrink-0">
                    {typeBadge(result.type)}
                    <span className="text-xs text-blue-600 whitespace-nowrap hidden sm:inline">查看笔记 →</span>
                    <span className="text-xs text-blue-600 sm:hidden">→</span>
                  </div>
                </div>
                <div className="relative">
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await copyToClipboard(result.content);
                      setCopiedIdx(idx);
                      setTimeout(() => setCopiedIdx(null), 1500);
                    }}
                    className="absolute top-0 right-0 w-7 h-7 flex items-center justify-center rounded-md text-xs transition-all hover:scale-110"
                    style={{ backgroundColor: copiedIdx === idx ? 'rgba(46,204,113,0.15)' : 'var(--bg-tertiary)', color: copiedIdx === idx ? '#2ecc71' : 'var(--text-muted)' }}
                    title={copiedIdx === idx ? '已复制 ✓' : '复制文本'}
                  >{copiedIdx === idx ? '✓' : <img src={copyText} alt="" className="w-3.5 h-3.5 object-contain" />}</button>
                  <div
                    className="text-gray-700 leading-relaxed pr-8"
                    dangerouslySetInnerHTML={{ __html: result.htmlHighlight ?? result.highlight }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-3 text-xs text-gray-400">
                  <span>{formatDate(result.createTime)}</span>
                  {result.chapterName && (
                    <>
                      <span>·</span>
                      <span>{result.chapterName}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}