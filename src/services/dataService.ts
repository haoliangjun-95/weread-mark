import {
  fetchAllNotebooks,
  fetchBookmarks,
  fetchAllBookReviews,
} from './weread';
import {
  isTauri,
  hasLocalData,
  resetLocalDb,
  queryNotebooks,
  queryShelfBooks,
  queryBookDetail,
  queryHasBookReview,
  queryTopReviews,
  queryOnThisDay,
  ftsSearch,
} from './localDb';
import type { OnThisDayItem } from './localDb';
import type { TopReviewItem } from './localDb';
import type { LocalSearchResult } from './localDb';
import type { BookItem, NotebookItem } from '../types/weread';
import type { BookDetailResult } from './localDb';

export { isTauri };
export type { LocalSearchResult, BookDetailResult };

/**
 * 数据读取统一入口：桌面版已同步时读本地 SQLite（毫秒级、可离线），
 * 否则回落到在线 API（Web 版与未同步的桌面版行为不变）。
 */

let localReadyPromise: Promise<boolean> | null = null;

function localReady(): Promise<boolean> {
  if (!isTauri) return Promise.resolve(false);
  if (!localReadyPromise) {
    localReadyPromise = hasLocalData().catch(() => false);
  }
  return localReadyPromise;
}

/** 本地库变为可用时广播（视图层监听后重新查询，避免挂载早于同步的组件拿不到数据） */
const LOCAL_READY_EVENT = 'weread-local-ready';

/** 供同步完成后切换到本地读路径（SettingsView 同步成功时调用）；重新评估完整性，部分失败则保持在线回退 */
export function markSynced(): void {
  localReadyPromise = hasLocalData().catch(() => false).then(ready => {
    if (ready) {
      window.dispatchEvent(new Event(LOCAL_READY_EVENT));
    }
    return ready;
  });
}

/** 监听本地库就绪（同步完成）事件，返回取消函数 */
export function onLocalReady(listener: () => void): () => void {
  window.addEventListener(LOCAL_READY_EVENT, listener);
  return () => window.removeEventListener(LOCAL_READY_EVENT, listener);
}

/** API Key 变更时调用：清空本地库与会话缓存，读路径回到在线模式，避免读到上一个账号的数据 */
export function handleApiKeyChanged(): void {
  if (isTauri) {
    void resetLocalDb().catch(err => console.warn('[dataService] 清空本地库失败：', err));
  }
  localReadyPromise = null;
  try {
    // sessionStorage 目前只有书评墙/排行榜的会话缓存，直接清空
    sessionStorage.clear();
  } catch {
    // ignore
  }
}

/** 笔记书列表：本地优先，否则在线（含 30 分钟 localStorage 缓存） */
export async function getNotebooks(): Promise<NotebookItem[]> {
  if (await localReady()) {
    try {
      return await queryNotebooks();
    } catch (err) {
      console.warn('[dataService] 本地读取失败，回退在线：', err);
    }
  }
  const data = await fetchAllNotebooks();
  return data.books || [];
}

/** 书架全部书：本地优先，否则在线 */
export async function getShelfBooks(): Promise<BookItem[] | null> {
  if (await localReady()) {
    try {
      return await queryShelfBooks();
    } catch (err) {
      console.warn('[dataService] 本地读取失败，回退在线：', err);
    }
  }
  return null;
}

/** 单本书划线/章节/想法+书评：本地优先，否则在线 */
export async function getBookDetail(bookId: string): Promise<BookDetailResult | null> {
  if (await localReady()) {
    try {
      return await queryBookDetail(bookId);
    } catch (err) {
      console.warn('[dataService] 本地读取失败，回退在线：', err);
    }
  }
  const [bmData, allReviews] = await Promise.all([
    fetchBookmarks(bookId),
    fetchAllBookReviews(bookId),
  ]);
  return {
    bookmarks: bmData.updated || [],
    chapters: bmData.chapters || [],
    reviews: allReviews,
  };
}

/** 往年今天动态：仅本地库（在线全库扫描代价过大，刻意不做降级）；未同步返回 null */
export async function getOnThisDay(): Promise<OnThisDayItem[] | null> {
  if (!(await localReady())) return null;
  try {
    return await queryOnThisDay();
  } catch (err) {
    console.warn('[dataService] 往年今天查询失败：', err);
    return null;
  }
}

/** 是否含书评：本地已同步时直接查库，未同步返回 null 由调用方走在线扫描 */
export async function hasBookReview(bookId: string): Promise<boolean | null> {
  if (await localReady()) {
    try {
      return await queryHasBookReview(bookId);
    } catch (err) {
      console.warn('[dataService] 本地查询失败，回退在线：', err);
      return null;
    }
  }
  return null;
}

/** 全文搜索：本地 FTS5；未同步返回 null，由调用方走在线流式搜索 */
export async function searchLocal(keyword: string): Promise<LocalSearchResult[] | null> {
  if (!(await localReady())) return null;
  try {
    return await ftsSearch(keyword);
  } catch (err) {
    console.warn('[dataService] 本地搜索失败，回退在线：', err);
    return null;
  }
}

/** 是否已同步本地库（用于 UI 提示「同步后可秒搜」） */
export async function isSynced(): Promise<boolean> {
  return localReady();
}

// ============ 点赞排行榜 ============

const RANK_CACHE_KEY = 'weread-rank-cache-v1';
const RANK_CACHE_TTL = 10 * 60 * 1000;

export interface RankScanProgress {
  done: number;
  total: number;
}

/**
 * 点赞排行（想法+书评按 likesCount 降序）：
 * 桌面版已同步 → 本地库秒出；否则在线扫描全部笔记书（带进度），结果缓存 10 分钟。
 */
export async function getTopReviews(
  limit = 200,
  onProgress?: (p: RankScanProgress) => void,
  isCancelled?: () => boolean,
): Promise<TopReviewItem[]> {
  if (await localReady()) {
    try {
      return await queryTopReviews(limit);
    } catch (err) {
      console.warn('[dataService] 本地排行读取失败，回退在线：', err);
    }
  }

  // 在线路径：sessionStorage 缓存 10 分钟
  try {
    const cached = sessionStorage.getItem(RANK_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as { ts: number; data: TopReviewItem[] };
      if (Date.now() - parsed.ts < RANK_CACHE_TTL && Array.isArray(parsed.data)) {
        return parsed.data.slice(0, limit);
      }
    }
  } catch {
    // ignore
  }

  const notebooks = await getNotebooks();
  const targets = notebooks.filter(nb => nb.reviewCount > 0 && nb.book?.bookId);
  const collected: TopReviewItem[] = [];
  let done = 0;
  const CONCURRENCY = 10;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (isCancelled?.()) return collected;
    const chunk = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (nb) => {
      const book = nb.book!;
      try {
        const allReviews = await fetchAllBookReviews(book.bookId);
        return allReviews
          .filter(rv => (rv.likesCount ?? 0) > 0 && (rv.review?.content || rv.review?.htmlContent))
          .map<TopReviewItem>(rv => ({
            reviewId: rv.review.reviewId,
            bookId: book.bookId,
            bookTitle: book.title || '',
            bookAuthor: book.author || '',
            bookCover: book.cover || '',
            content: rv.review.content || '',
            htmlContent: rv.review.htmlContent,
            createTime: rv.review.createTime || 0,
            likesCount: rv.likesCount ?? 0,
            type: rv.review.type ?? null,
            chapterName: rv.review.chapterName,
          }));
      } catch {
        return [] as TopReviewItem[];
      } finally {
        done++;
      }
    }));
    if (isCancelled?.()) return collected;
    collected.push(...results.flat());
    onProgress?.({ done: Math.min(done, targets.length), total: targets.length });
  }

  collected.sort((a, b) => b.likesCount - a.likesCount || b.createTime - a.createTime);
  const top = collected.slice(0, 500);
  try {
    sessionStorage.setItem(RANK_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: top }));
  } catch {
    // ignore
  }
  return top.slice(0, limit);
}
