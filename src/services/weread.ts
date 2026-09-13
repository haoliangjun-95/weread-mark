import type {
  ApiRequestParams,
  ShelfData,
  ReadingStats,
  NotebooksData,
  BookmarkListData,
  ReviewsData,
  ReviewItem,
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
    // Key 变更后旧账号的笔记列表缓存立即失效
    clearNotebooksCache();
  } catch {
    // localStorage writes can fail in restricted browser contexts.
  }
}

export async function validateApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // 保存目标 key 后复用统一的 callApi 通道（限速/桥接/错误处理一份逻辑）
    const prev = getApiKey();
    setApiKey(key);
    try {
      await callApi<ShelfData>({ api_name: '/shelf/sync' });
      return { valid: true };
    } finally {
      setApiKey(prev);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('401')) {
      return { valid: false, error: '输入的Key错误，请从微信读书官网获取正确的key' };
    }
    return { valid: false, error: e instanceof Error ? e.message : '网络错误，请检查网络后重试' };
  }
}

function clearApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Ignore storage cleanup failures; the request error still surfaces.
  }
  clearNotebooksCache();
}

class MissingApiKeyError extends Error {
  constructor() {
    super('请先在首页设置微信读书API Key');
    this.name = 'MissingApiKeyError';
  }
}

// ============ 全局限速与频控退避 ============
// 网关按单 Key 限频（errcode -2014「请求频率超限」，可能伴随 HTTP 403/429），
// 用信号量限制在途并发 + 全局最小发起间隔配速，所有 callApi 共享。
class ThrottledError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ThrottledError';
  }
}

const MAX_CONCURRENT_REQUESTS = 6;
const MIN_REQUEST_INTERVAL_MS = 150; // 全局配速：约 6-7 请求/秒上限
let activeCount = 0;
let lastRequestAt = 0;
const waitQueue: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (activeCount >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>(resolve => waitQueue.push(resolve));
  }
  activeCount++;
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) next();
}

async function callApi<T>(params: ApiRequestParams, signal?: AbortSignal): Promise<T> {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new MissingApiKeyError();
  }

  // 频控（HTTP 403/429 或响应体 errcode -2014）退避重试，给网关配额恢复留时间
  const RETRY_DELAYS_MS = [5000, 15000, 30000];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    await acquireSlot();
    try {
      return await requestOnce<T>(params, apiKey, signal);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!(err instanceof ThrottledError)) throw err;
    } finally {
      releaseSlot();
    }
  }
  throw lastError;
}

/** 鸿蒙 ArkWeb 壳注入的原生 HTTP 桥（绕过 WebView 的 CORS 限制） */
interface HarmonyHttpBridge {
  httpPost(path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }>;
}

type GatewayBody = { errcode?: number; errmsg?: string };

async function requestOnce<T>(params: ApiRequestParams, apiKey: string, signal?: AbortSignal): Promise<T> {
  const payload = JSON.stringify({
    ...params,
    skill_version: SKILL_VERSION,
  });
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let body: GatewayBody | null;
  let httpStatus: number;

  if (API_URL.startsWith('bridge://')) {
    // 鸿蒙：API_URL 形如 bridge://api/agent/gateway，路径由原生桥拼到真实网关
    const bridge = (window as unknown as { HarmonyBridge?: HarmonyHttpBridge }).HarmonyBridge;
    if (!bridge?.httpPost) {
      throw new Error('鸿蒙原生桥未注入（请在 App 内打开，而非浏览器）');
    }
    const res = await bridge.httpPost(API_URL.slice('bridge://'.length), headers, payload);
    httpStatus = res.status;
    try {
      body = JSON.parse(res.body) as GatewayBody;
    } catch {
      body = null;
    }
  } else {
    // 15 秒超时，防止个别请求永久挂起拖死整页加载
    const timeoutSignal = AbortSignal.timeout(15000);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: payload,
        signal: requestSignal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      throw new Error(`网络请求失败（${params.api_name}），请检查网络连接后重试`, { cause: err });
    }
    httpStatus = response.status;
    if (response.ok) {
      body = (await response.json()) as GatewayBody;
    } else {
      // 非 2xx 也尽量解析响应体，网关频控错误在 HTTP 403 的 body 里（errcode -2014）
      try {
        body = (await response.clone().json()) as GatewayBody;
      } catch {
        body = null;
      }
    }
  }
  if (body && body.errcode && body.errcode !== 0) {
    const message = body.errmsg || `API 错误：${body.errcode} (${params.api_name})`;
    if (body.errcode === -2014) {
      throw new ThrottledError(message);
    }
    throw new Error(message);
  }

  if (httpStatus < 200 || httpStatus >= 300) {
    if (httpStatus === 401) {
      clearApiKey();
    }
    const message = `API 请求失败：HTTP ${httpStatus} (${params.api_name})`;
    if (httpStatus === 403 || httpStatus === 429) {
      throw new ThrottledError(message);
    }
    throw new Error(message);
  }

  return body as T;
}

// Shelf API
export async function fetchShelf(): Promise<ShelfData> {
  return callApi<ShelfData>({
    api_name: '/shelf/sync',
  });
}

// Reading Stats API
// 看板单次加载会请求 20+ 个统计接口，是配额消耗大户：
// 这里做「缓存 + 相同参数请求合并」。历史周期（两个月前及更早）数据不会变，缓存 24 小时；
// 当前周期 5 分钟。所有缓存仅在内存（刷新页面后重拉，保证数据新鲜度可控）。
const statsMemoryCache = new Map<string, { expiresAt: number; data: ReadingStats }>();
const statsInflight = new Map<string, Promise<ReadingStats>>();

function statsCacheKey(mode: string, baseTime?: number): string {
  return `${mode}:${baseTime ?? 'now'}`;
}

function statsTtlMs(baseTime?: number): number {
  if (baseTime !== undefined) {
    const twoMonthsAgo = (Date.now() - 62 * 24 * 3600 * 1000) / 1000;
    if (baseTime < twoMonthsAgo) return 24 * 3600 * 1000;
  }
  return 5 * 60 * 1000;
}

export async function fetchReadingStats(
  mode: 'weekly' | 'monthly' | 'annually' | 'overall' = 'monthly',
  baseTime?: number
): Promise<ReadingStats> {
  const key = statsCacheKey(mode, baseTime);
  const cached = statsMemoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // 相同参数的在途请求直接复用，避免看板重复发起
  const inflight = statsInflight.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    const params: ApiRequestParams = {
      api_name: '/readdata/detail',
      mode,
    };
    if (baseTime !== undefined) {
      params.baseTime = baseTime;
    }
    try {
      const data = await callApi<ReadingStats>(params);
      statsMemoryCache.set(key, { expiresAt: Date.now() + statsTtlMs(baseTime), data });
      return data;
    } finally {
      statsInflight.delete(key);
    }
  })();
  statsInflight.set(key, promise);
  return promise;
}

// Notebooks API
const NOTEBOOKS_CACHE_KEY = 'weread-notebooks-cache';
const NOTEBOOKS_CACHE_TTL = 30 * 60 * 1000; // 30 分钟内直接用缓存，避免每次刷新全量重拉

interface NotebooksCache {
  savedAt: number;
  data: NotebooksData;
}

function readNotebooksCache(maxAge: number): NotebooksData | null {
  try {
    const raw = localStorage.getItem(NOTEBOOKS_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as NotebooksCache;
    if (Date.now() - cache.savedAt > maxAge || !Array.isArray(cache.data?.books)) return null;
    return cache.data;
  } catch {
    return null;
  }
}

function writeNotebooksCache(data: NotebooksData): void {
  try {
    const cache: NotebooksCache = { savedAt: Date.now(), data };
    localStorage.setItem(NOTEBOOKS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 存储空间不足或受限环境时静默降级，不影响正常流程
  }
}

function clearNotebooksCache(): void {
  try {
    localStorage.removeItem(NOTEBOOKS_CACHE_KEY);
  } catch {
    // ignore
  }
}

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
  const fresh = readNotebooksCache(NOTEBOOKS_CACHE_TTL);
  if (fresh) return fresh;

  try {
    const data = await fetchAllNotebooksRemote(retryOnError);
    writeNotebooksCache(data);
    return data;
  } catch (err) {
    // 请求失败时降级返回过期缓存（如果有），避免网络抖动导致整个页面不可用
    const stale = readNotebooksCache(Number.MAX_SAFE_INTEGER);
    if (stale) return stale;
    throw err;
  }
}

async function fetchAllNotebooksRemote(retryOnError = true): Promise<NotebooksData> {
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
export async function fetchBookReviews(
  bookId: string,
  synckey = 0,
  count = 100,
  signal?: AbortSignal
): Promise<ReviewsData> {
  return callApi<ReviewsData>({
    api_name: '/review/list/mine',
    bookid: bookId,
    synckey,
    count,
  }, signal);
}

/**
 * 拉全单本书的想法+书评。
 * 注意：该接口的 synckey 实际是「增量同步 key」而非页码游标——把回包 synckey 传回去
 * 只会得到比它更新的内容（通常为空），按页翻会永远只拿到第一页（实测 70 本书卡在 20 条）。
 * 正确策略：一次请求用大 count 拉尽量多；若仍有缺口且 hasMore=1，再用 synckey 补拉增量。
 * 以回包 totalCount 做完整性校验，reviewId 去重防死循环。
 */
export async function fetchAllBookReviews(bookId: string, signal?: AbortSignal): Promise<ReviewItem[]> {
  const PAGE_SIZE = 100;
  const all = new Map<string, ReviewItem>();
  let synckey = 0;
  let total = Number.POSITIVE_INFINITY;
  const MAX_ROUNDS = 30; // 防御上限

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const data = await fetchBookReviews(bookId, synckey, PAGE_SIZE, signal);
    if (data.totalCount != null && data.totalCount > 0) total = data.totalCount;
    const reviews = data.reviews || [];
    if (reviews.length === 0) break;

    let newCount = 0;
    for (const rv of reviews) {
      if (rv.review?.reviewId && !all.has(rv.review.reviewId)) {
        all.set(rv.review.reviewId, rv);
        newCount++;
      }
    }
    if (!data.hasMore) break;
    if (newCount === 0) break;            // 本页全是重复内容，已到尽头
    if (all.size >= total) break;          // 已收集够 totalCount 条
    if (data.synckey == null || data.synckey === synckey) break; // 游标停滞
    synckey = data.synckey;
  }

  if (all.size < total) {
    console.warn(`[fetchAllBookReviews] ${bookId} 可能不完整：${all.size}/${total}（count 上限或游标停滞）`);
  }
  return [...all.values()];
}
