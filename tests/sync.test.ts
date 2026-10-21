/**
 * syncAll 同步主流程单测：增量判断、自愈对账、重试轮、落库校验、远端删除清理、
 * 鸿蒙字符串值归一（回归重点）。
 * 通过 mock 环境检测（isTauri）+ tauri plugin-sql + 网络层（weread.ts），
 * db 用按 SQL 特征路由的内存模型模拟。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookItem, NotebookItem, BookmarkItem, ReviewItem } from '../src/types/weread';

// vi.mock 工厂被提升到文件顶部执行，引用的变量必须经 vi.hoisted 同步创建
const { memoryDb, wereadMocks } = vi.hoisted(() => {
  class MemoryDb {
  books = new Map<string, Record<string, unknown>>();
  bookmarks = new Map<string, unknown[]>();
  reviews = new Map<string, unknown[]>();
  chapters = new Map<string, unknown[]>();
  syncedAt = new Map<string, number>();
  meta = new Map<string, string>();
  snapshots: unknown[][] = [];
  /** 故障注入：executeMany 偷丢比例（0-1），模拟并发批写丢行 */
  dropRate = 0;

  execute = vi.fn(async (sql: string, params?: unknown[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('CREATE') || s.startsWith('ALTER')) return;
    if (s.startsWith('DELETE FROM bookmarks')) return void this.bookmarks.delete(String(params?.[0]));
    if (s.startsWith('DELETE FROM reviews')) return void this.reviews.delete(String(params?.[0]));
    if (s.startsWith('DELETE FROM chapters')) return void this.chapters.delete(String(params?.[0]));
    if (s.startsWith('DELETE FROM books')) return void this.books.delete(String(params?.[0]));
    if (s.startsWith('INSERT OR REPLACE INTO books')) { this.books.set(String(params?.[0]), params ?? []); return; }
    // 逐条明细写入（tauri 路径无 executeMany）：按参数列序 bookId 分组
    if (s.startsWith('INSERT OR REPLACE INTO bookmarks') || s.startsWith('INSERT OR REPLACE INTO reviews') || s.startsWith('INSERT OR REPLACE INTO chapters')) {
      if (this.dropRate > 0 && Math.random() < this.dropRate) return; // 故障注入：模拟并发丢行
      const id = String(s.includes('INTO chapters') ? params?.[0] : params?.[1]);
      const table = s.includes('bookmarks') ? this.bookmarks : s.includes('reviews') ? this.reviews : this.chapters;
      table.set(id, [...(table.get(id) || []), params ?? []]);
      return;
    }
    if (s.startsWith('INSERT OR REPLACE INTO sync_meta')) { this.meta.set(String(params?.[0]), String(params?.[1])); return; }
    if (s.startsWith('INSERT OR REPLACE INTO stats_snapshots')) { this.snapshots.push(params ?? []); return; }
    if (s.startsWith('UPDATE books SET syncedAt')) { this.syncedAt.set(String(params?.[1]), Number(params?.[0])); return; }
    return;
  });

  executeMany = vi.fn(async (sql: string, rows: unknown[][]) => {
    const s = sql.replace(/\s+/g, ' ');
    let kept = rows;
    if (this.dropRate > 0) {
      kept = rows.filter(() => Math.random() >= this.dropRate);
    }
    if (s.includes('INTO bookmarks')) {
      const byBook = new Map<string, unknown[]>();
      kept.forEach(r => byBook.set(String(r[1]), [...(byBook.get(String(r[1])) || []), r]));
      byBook.forEach((v, k) => this.bookmarks.set(k, v));
    } else if (s.includes('INTO chapters')) {
      kept.forEach(r => this.chapters.set(String(r[0]), [...(this.chapters.get(String(r[0])) || []), r]));
    } else if (s.includes('INTO reviews')) {
      const byBook = new Map<string, unknown[]>();
      kept.forEach(r => byBook.set(String(r[1]), [...(byBook.get(String(r[1])) || []), r]));
      byBook.forEach((v, k) => this.reviews.set(k, v));
    }
  });

  select = vi.fn(async (sql: string, params?: unknown[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT value FROM sync_meta')) {
      const v = this.meta.get(String(params?.[0]));
      return v != null ? [{ value: v }] : [];
    }
    if (s.startsWith('SELECT bookId, COUNT(*)')) {
      return [...this.reviews.entries()].map(([bookId, rows]) => ({ bookId, c: rows.length }));
    }
    if (s.startsWith('SELECT COUNT(*)') && s.includes('markedStatus = 4')) {
      return [{ c: [...this.books.values()].filter((r: unknown[]) => Number(r[7]) === 4).length }];
    }
    if (s.startsWith('SELECT bookId, noteCount')) {
      // books 表内容直接由 fixture 提供（模拟上次同步留下的行，含字符串值场景）
      return this.existingFixture ?? [];
    }
    if (s.includes('(SELECT COUNT(*) FROM bookmarks')) {
      const id = String(params?.[0]);
      return [{ bm: this.bookmarks.get(id)?.length ?? 0, rv: this.reviews.get(id)?.length ?? 0 }];
    }
    return [];
  });

  /** 预置 existing 行（模拟上次同步留下的 books 表内容，可含字符串值模拟鸿蒙桥） */
  existingFixture: Array<Record<string, unknown>> | null = null;
}


  return {
    memoryDb: new MemoryDb(),
    wereadMocks: {
      fetchShelf: vi.fn(),
      fetchAllNotebooks: vi.fn(),
      fetchBookmarks: vi.fn(),
      fetchAllBookReviews: vi.fn(),
      fetchReadingStats: vi.fn(async () => ({ totalReadTime: 100, readDays: 2 })),
    },
  };
});

// ---------- 模块 mock ----------


// ---------- 模块 mock ----------
vi.mock('../src/services/dbInterface', () => ({
  isTauri: true,
  isCapacitor: false,
  isHarmony: false,
  isNativeApp: true,
  runtimeEnv: 'tauri',
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: async () => ({
      execute: memoryDb.execute,
      select: memoryDb.select,
      close: async () => undefined,
    }),
  },
}));

vi.mock('../src/services/weread', () => wereadMocks);

// 模块导入（在 mock 生效后）
import { syncAll } from '../src/services/localDb';

// ---------- 测试数据工厂 ----------
function makeBook(id: string, title = id): BookItem {
  return { bookId: id, title, author: '作者', cover: '', category: '文学', readUpdateTime: 1000, finishReading: 0, updateTime: 1000, isTop: 0, secret: 0 };
}
function makeNotebook(id: string, counts: { note?: number; review?: number; bookmark?: number; marked?: number }): NotebookItem {
  return {
    bookId: id, book: makeBook(id), readingProgress: 0, sort: 0,
    noteCount: counts.note ?? 0, reviewCount: counts.review ?? 0,
    bookmarkCount: counts.bookmark ?? 0, markedStatus: counts.marked ?? 0,
  };
}
function makeBookmark(id: string): BookmarkItem {
  return { bookmarkId: `bm-${id}-${Math.random()}`, bookId: id, chapterUid: 1, markText: '划线内容', createTime: 1700000000, type: 0, range: '1-2', colorStyle: 0 };
}
function makeReview(id: string): ReviewItem {
  return { likesCount: 0, review: { reviewId: `rv-${id}-${Math.random()}`, content: '想法内容', createTime: 1700000000, star: 0 } };
}

/** 配置一次同步的远端数据与本地已有状态 */
function setupRemote(notebooks: NotebookItem[], opts: {
  existing?: Array<Record<string, unknown>>;
  reviews?: (bookId: string) => ReviewItem[];
  failFirst?: Set<string>; // 首轮明细拉取失败的 bookId（重试轮恢复）
} = {}) {
  wereadMocks.fetchShelf.mockResolvedValue({ books: notebooks.map(nb => nb.book), albums: [], archive: [], mp: undefined, bookCount: notebooks.length });
  wereadMocks.fetchAllNotebooks.mockResolvedValue({ totalBookCount: notebooks.length, totalNoteCount: 0, hasMore: 0, books: notebooks });
  wereadMocks.fetchReadingStats.mockResolvedValue({ totalReadTime: 100, readDays: 2 });
  memoryDb.existingFixture = opts.existing ?? null;
  wereadMocks.fetchBookmarks.mockImplementation(async (bookId: string) => ({
    updated: [makeBookmark(bookId)], chapters: [{ chapterUid: 1, chapterIdx: 0, title: '第一章' }], book: makeBook(bookId),
  }));
  // 默认按各书线上 reviewCount 生成，保证完整性校验天然通过
  const reviewsOf = opts.reviews ?? ((id: string) => {
    const n = notebooks.find(nb => nb.bookId === id)?.reviewCount ?? 0;
    return Array.from({ length: n }, () => makeReview(id));
  });
  const attempted = new Set<string>();
  wereadMocks.fetchAllBookReviews.mockImplementation(async (bookId: string) => {
    if (opts.failFirst?.has(bookId) && !attempted.has(bookId)) {
      attempted.add(bookId);
      throw new Error('瞬时限流');
    }
    return reviewsOf(bookId);
  });
  // 重置内存表但保留 existingFixture
  memoryDb.books.clear(); memoryDb.bookmarks.clear(); memoryDb.reviews.clear();
  memoryDb.chapters.clear(); memoryDb.syncedAt.clear(); memoryDb.meta.clear();
  memoryDb.snapshots.length = 0; memoryDb.dropRate = 0;
  memoryDb.execute.mockClear(); memoryDb.executeMany.mockClear();
  wereadMocks.fetchShelf.mockClear(); wereadMocks.fetchAllNotebooks.mockClear();
  wereadMocks.fetchBookmarks.mockClear(); wereudMocksClear();
}
function wereudMocksClear() {
  wereadMocks.fetchBookmarks.mockClear();
  wereadMocks.fetchAllBookReviews.mockClear();
  wereadMocks.fetchReadingStats.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncAll 同步主流程', () => {
  it('首次同步：全部书拉明细、逐书标记 syncedAt、写统计快照', async () => {
    const nbs = [makeNotebook('a', { note: 1, review: 2, bookmark: 1 }), makeNotebook('b', { note: 0, review: 3, bookmark: 2 })];
    setupRemote(nbs);
    const result = await syncAll();
    expect(result).toMatchObject({ failedCount: 0, changedCount: 2, totalCount: 2 });
    expect(wereadMocks.fetchBookmarks).toHaveBeenCalledTimes(2);
    expect(wereadMocks.fetchAllBookReviews).toHaveBeenCalledTimes(2);
    expect([...memoryDb.syncedAt.keys()].sort()).toEqual(['a', 'b']);
    expect(memoryDb.snapshots.length).toBe(1);
    expect(memoryDb.meta.get('lastSyncAt')).toBeTruthy();
  });

  it('增量同步：已同步且计数未变的书不拉明细', async () => {
    const nbs = [makeNotebook('a', { note: 1, review: 2, bookmark: 1 })];
    setupRemote(nbs, {
      existing: [{ bookId: 'a', noteCount: 1, reviewCount: 2, bookmarkCount: 1, markedStatus: 0, syncedAt: 1700000000 }],
    });
    // 上次同步留下的本地想法行（自愈对账通过，不该重拉）
    memoryDb.reviews.set('a', [[], []]);
    const result = await syncAll();
    expect(result.changedCount).toBe(0);
    expect(wereadMocks.fetchBookmarks).not.toHaveBeenCalled();
  });

  it('计数变化触发重拉（noteCount 变化）', async () => {
    const nbs = [makeNotebook('a', { note: 5, review: 0, bookmark: 0 })];
    setupRemote(nbs, {
      existing: [{ bookId: 'a', noteCount: 2, reviewCount: 0, bookmarkCount: 0, markedStatus: 0, syncedAt: 1700000000 }],
    });
    const result = await syncAll();
    expect(result.changedCount).toBe(1);
    expect(wereadMocks.fetchBookmarks).toHaveBeenCalledTimes(1);
  });

  it('自愈路径：本地想法条数少于线上 reviewCount 时重拉', async () => {
    const nbs = [makeNotebook('a', { note: 0, review: 4, bookmark: 0 })];
    setupRemote(nbs, {
      existing: [{ bookId: 'a', noteCount: 0, reviewCount: 4, bookmarkCount: 0, markedStatus: 0, syncedAt: 1700000000 }],
    });
    // 本地 reviews 表只有 2 条（少于线上 4）——通过预置 reviews 模拟历史缺页
    memoryDb.reviews.set('a', [[], []]);
    const result = await syncAll();
    expect(result.changedCount).toBe(1);
    expect(wereadMocks.fetchAllBookReviews).toHaveBeenCalledWith('a');
  });

  it('想法拉取不完整（数量少于 reviewCount）视为失败并重试，重试完整则成功', async () => {
    const nbs = [makeNotebook('a', { note: 0, review: 5, bookmark: 0 })];
    // reviews 工厂：首轮返回 2 条（不完整），重试轮返回 5 条
    let call = 0;
    wereadMocks.fetchShelf.mockResolvedValue({ books: [nbs[0].book], albums: [], archive: [], mp: undefined, bookCount: 1 });
    wereadMocks.fetchAllNotebooks.mockResolvedValue({ totalBookCount: 1, totalNoteCount: 0, hasMore: 0, books: nbs });
    wereadMocks.fetchBookmarks.mockResolvedValue({ updated: [], chapters: [], book: nbs[0].book });
    wereadMocks.fetchAllBookReviews.mockImplementation(async () => {
      call++;
      return Array.from({ length: call === 1 ? 2 : 5 }, () => makeReview('a'));
    });
    memoryDb.existingFixture = null;
    memoryDb.books.clear(); memoryDb.reviews.clear(); memoryDb.syncedAt.clear();
    memoryDb.meta.clear(); memoryDb.snapshots.length = 0;
    memoryDb.dropRate = 0;

    const progress: string[] = [];
    const result = await syncAll(p => { if (p.stage) progress.push(p.stage); });
    expect(result.failedCount).toBe(0);
    expect(wereadMocks.fetchAllBookReviews).toHaveBeenCalledTimes(2);
    expect(progress.some(s => s.includes('重试'))).toBe(true);
  });

  it('重试仍失败：计入 failedCount 且样本含原因', async () => {
    const nbs = [makeNotebook('a', { note: 0, review: 5, bookmark: 0 })];
    wereadMocks.fetchShelf.mockResolvedValue({ books: [nbs[0].book], albums: [], archive: [], mp: undefined, bookCount: 1 });
    wereadMocks.fetchAllNotebooks.mockResolvedValue({ totalBookCount: 1, totalNoteCount: 0, hasMore: 0, books: nbs });
    wereadMocks.fetchBookmarks.mockResolvedValue({ updated: [], chapters: [], book: nbs[0].book });
    wereadMocks.fetchAllBookReviews.mockResolvedValue(Array.from({ length: 2 }, () => makeReview('a'))); // 恒不完整
    memoryDb.existingFixture = null;
    memoryDb.books.clear(); memoryDb.reviews.clear(); memoryDb.syncedAt.clear();
    memoryDb.meta.clear(); memoryDb.snapshots.length = 0;
    memoryDb.dropRate = 0;

    const result = await syncAll();
    expect(result.failedCount).toBe(1);
    expect(result.failureSamples[0].reason).toContain('想法拉取不完整');
    expect(memoryDb.syncedAt.get('a')).toBeUndefined();
  });

  it('落库校验失败（批写丢行）进入重试', async () => {
    const nbs = [makeNotebook('a', { note: 1, review: 2, bookmark: 2 })];
    setupRemote(nbs);
    memoryDb.dropRate = 1; // 首轮明细写入全丢（消除随机性）→ 落库校验必失败
    // 重试轮（fetchAllBookReviews 第 2 次调用）恢复干净写入
    let fetchCalls = 0;
    wereadMocks.fetchAllBookReviews.mockImplementation(async (bookId: string) => {
      fetchCalls++;
      if (fetchCalls >= 2) memoryDb.dropRate = 0; // 重试轮恢复干净写入
      return Array.from({ length: 2 }, () => makeReview(bookId));
    });
    const result = await syncAll();
    expect(result.failedCount).toBe(0); // 重试轮落库完整
    expect(wereadMocks.fetchAllBookReviews).toHaveBeenCalledTimes(2);
  });

  it('远端已删除的书：本地 books/明细级联清理', async () => {
    const nbs = [makeNotebook('a', { note: 0, review: 0, bookmark: 0 })];
    setupRemote(nbs, {
      existing: [{ bookId: 'gone', noteCount: 0, reviewCount: 0, bookmarkCount: 0, markedStatus: 0, syncedAt: 1700000000 }],
    });
    await syncAll();
    // books/明细四张表均发出针对 gone 的删除（params 是数组，取首元素）
    for (const table of ['books', 'bookmarks', 'reviews', 'chapters']) {
      const hit = memoryDb.execute.mock.calls.some(c =>
        String(c[0]).includes(`DELETE FROM ${table} WHERE bookId`) && c[1]?.[0] === 'gone');
      expect(hit, `${table} 应被级联删除`).toBe(true);
    }
  });

  it('鸿蒙字符串值回归：syncedAt="0" 与计数字符串仍正确触发重拉/跳过', async () => {
    const nbs = [makeNotebook('a', { note: 1, review: 2, bookmark: 1 })];
    setupRemote(nbs, {
      // 鸿蒙桥读出的历史行全是字符串
      existing: [{ bookId: 'a', noteCount: '1', reviewCount: '2', bookmarkCount: '1', markedStatus: '0', syncedAt: '1700000000' }],
    });
    memoryDb.reviews.set('a', [[], []]);
    const result = await syncAll();
    // 计数一致 + syncedAt 非 0 → 跳过（字符串被归一为数字参与比较）
    expect(result.changedCount).toBe(0);

    setupRemote(nbs, {
      existing: [{ bookId: 'a', noteCount: '1', reviewCount: '2', bookmarkCount: '1', markedStatus: '0', syncedAt: '0' }],
    });
    const result2 = await syncAll();
    expect(result2.changedCount).toBe(1); // "0" 归一为 0 → 视为从未同步
  });

  it('进度回调：books → contents 两阶段且 done 单调不减', async () => {
    const nbs = ['a', 'b', 'c'].map(id => makeNotebook(id, { note: 1, review: 1, bookmark: 1 }));
    setupRemote(nbs);
    const events: Array<{ phase: string; done: number; total: number }> = [];
    await syncAll(p => events.push({ phase: p.phase, done: p.done, total: p.total }));
    expect(events[0].phase).toBe('books');
    const contents = events.filter(e => e.phase === 'contents');
    expect(contents.length).toBeGreaterThan(0);
    let prev = -1;
    contents.forEach(e => { expect(e.done).toBeGreaterThanOrEqual(prev); prev = e.done; });
    expect(prev).toBe(contents[contents.length - 1].total);
  });
});
