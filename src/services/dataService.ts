import {
  fetchAllNotebooks,
  fetchBookmarks,
  fetchBookReviews,
} from './weread';
import {
  isTauri,
  hasLocalData,
  queryNotebooks,
  queryShelfBooks,
  queryBookDetail,
  queryHasBookReview,
  ftsSearch,
} from './localDb';
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

/** 供同步完成后切换到本地读路径（SettingsView 同步成功时调用） */
export function markSynced(): void {
  localReadyPromise = Promise.resolve(true);
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
  const [bmData, rvData] = await Promise.all([
    fetchBookmarks(bookId),
    fetchBookReviews(bookId),
  ]);
  return {
    bookmarks: bmData.updated || [],
    chapters: bmData.chapters || [],
    reviews: rvData.reviews || [],
  };
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
