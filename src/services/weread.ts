import type {
  ApiRequestParams,
  ShelfData,
  ReadingStats,
  NotebooksData,
  BookmarkListData,
  ReviewsData,
} from '../types/weread';

const API_URL = import.meta.env.VITE_WEREAD_API_URL || '/api/agent/gateway';
const SKILL_VERSION = import.meta.env.VITE_SKILL_VERSION || '1.0.4';
const API_KEY_STORAGE = 'weread-api-key';

export function getApiKey(): string {
  try {
    const fromStorage = localStorage.getItem(API_KEY_STORAGE);
    if (fromStorage && fromStorage.trim()) return fromStorage.trim();
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
  return '';
}

export function setApiKey(key: string): void {
  try {
    if (key && key.trim()) {
      localStorage.setItem(API_KEY_STORAGE, key.trim());
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
    }
  } catch {
    // localStorage writes can fail in restricted browser contexts.
  }
}

export async function validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_name: '/shelf/sync',
        skill_version: SKILL_VERSION,
      }),
    });
    if (response.status === 401) {
      return { valid: false, error: '输入的Key错误，请从微信读书官网获取正确的key' };
    }
    if (!response.ok) {
      return { valid: false, error: `请求失败: HTTP ${response.status}` };
    }
    const data = await response.json();
    if (data.errcode && data.errcode !== 0) {
      return { valid: false, error: data.errmsg || 'API Key 无效，请检查后重试' };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : '网络错误，请检查网络后重试' };
  }
}

function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Ignore storage cleanup failures; the request error still surfaces.
  }
}

class MissingApiKeyError extends Error {
  constructor() {
    super('请先在首页设置微信读书API Key');
    this.name = 'MissingApiKeyError';
  }
}

async function callApi<T>(params: ApiRequestParams, signal?: AbortSignal): Promise<T> {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new MissingApiKeyError();
  }

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...params,
        skill_version: SKILL_VERSION,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    throw new Error(`网络请求失败（${params.api_name}），请检查网络连接后重试`, { cause: err });
  }

  if (!response.ok) {
    if (response.status === 401) {
      clearApiKey();
    }
    throw new Error(`API 请求失败：HTTP ${response.status} (${params.api_name})`);
  }

  const data = await response.json();

  if (data.errcode && data.errcode !== 0) {
    throw new Error(data.errmsg || `API 错误：${data.errcode} (${params.api_name})`);
  }

  return data as T;
}

// Shelf API
export async function fetchShelf(): Promise<ShelfData> {
  return callApi<ShelfData>({
    api_name: '/shelf/sync',
  });
}

// Reading Stats API
export async function fetchReadingStats(
  mode: 'weekly' | 'monthly' | 'annually' | 'overall' = 'monthly',
  baseTime?: number
): Promise<ReadingStats> {
  const params: ApiRequestParams = {
    api_name: '/readdata/detail',
    mode,
  };

  if (baseTime !== undefined) {
    params.baseTime = baseTime;
  }

  return callApi<ReadingStats>(params);
}

// Notebooks API
async function fetchNotebooks(lastSort?: number): Promise<NotebooksData> {
  const params: ApiRequestParams = {
    api_name: '/user/notebooks',
    count: 100,
  };

  if (lastSort !== undefined) {
    params.lastSort = lastSort;
  }

  return callApi<NotebooksData>(params);
}

export async function fetchAllNotebooks(retryOnError = true): Promise<NotebooksData> {
  const allBooks: NotebooksData['books'] = [];
  let lastSort: number | undefined;
  let hasMore = 1;
  let prevLastSort: number | undefined;
  let iterations = 0;
  const MAX_ITERATIONS = 50;
  const MAX_RETRIES = 2;

  while (hasMore) {
    if (iterations++ >= MAX_ITERATIONS) {
      console.warn('[fetchAllNotebooks] reached max iterations, aborting');
      break;
    }

    let data: NotebooksData;
    let retries = 0;
    while (true) {
      try {
        data = await fetchNotebooks(lastSort);
        break;
      } catch (err) {
        if (!retryOnError || retries >= MAX_RETRIES) throw err;
        retries++;
        console.warn(`[fetchAllNotebooks] retry ${retries}/${MAX_RETRIES} after error:`, err);
        await new Promise(r => setTimeout(r, 1000 * retries));
      }
    }

    if (!data.books || data.books.length === 0) break;
    allBooks.push(...data.books);
    hasMore = data.hasMore;
    if (!hasMore) break;
    const nextLastSort = data.books[data.books.length - 1].sort;
    if (nextLastSort === prevLastSort) {
      console.warn('[fetchAllNotebooks] lastSort not advancing, aborting to prevent loop');
      break;
    }
    prevLastSort = lastSort;
    lastSort = nextLastSort;
  }

  return {
    totalBookCount: allBooks.length,
    totalNoteCount: allBooks.reduce(
      (sum, book) => sum + book.reviewCount + book.noteCount + book.bookmarkCount,
      0
    ),
    hasMore: 0,
    books: allBooks,
  };
}

// Bookmarks API
export async function fetchBookmarks(bookId: string, signal?: AbortSignal): Promise<BookmarkListData> {
  return callApi<BookmarkListData>({
    api_name: '/book/bookmarklist',
    bookId,
  }, signal);
}

// Reviews API
export async function fetchBookReviews(bookId: string, synckey = 0, signal?: AbortSignal): Promise<ReviewsData> {
  return callApi<ReviewsData>({
    api_name: '/review/list/mine',
    bookid: bookId,
    synckey,
    count: 20,
  }, signal);
}
