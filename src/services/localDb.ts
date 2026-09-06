import Database from '@tauri-apps/plugin-sql';
import {
  fetchShelf,
  fetchAllNotebooks,
  fetchBookmarks,
  fetchBookReviews,
  fetchReadingStats,
} from './weread';
import type {
  BookItem,
  NotebookItem,
  BookmarkItem,
  ChapterItem,
  ReviewItem,
} from '../types/weread';

/** 运行时检测 Tauri 环境（tauri dev 不走 tauri mode，不能用 env 判断） */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const DB_URL = 'sqlite:weread.db';
const SCHEMA_VERSION = 1;

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then(async (db) => {
      await migrate(db);
      return db;
    });
    // 失败时清除缓存，否则一次失败后（如权限问题）后续重试永远拿到同一个 rejected promise
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function migrate(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const versionRow = await db.select<{ value: string }[]>(
    'SELECT value FROM sync_meta WHERE key = ?',
    ['schema_version'],
  );
  const current = versionRow.length > 0 ? parseInt(versionRow[0].value, 10) : 0;
  if (current >= SCHEMA_VERSION) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS books (
      bookId TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      readUpdateTime INTEGER NOT NULL DEFAULT 0,
      finishReading INTEGER NOT NULL DEFAULT 0,
      markedStatus INTEGER NOT NULL DEFAULT 0,
      noteCount INTEGER NOT NULL DEFAULT 0,
      reviewCount INTEGER NOT NULL DEFAULT 0,
      bookmarkCount INTEGER NOT NULL DEFAULT 0,
      readingProgress REAL NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      updatedAt INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      bookmarkId TEXT PRIMARY KEY,
      bookId TEXT NOT NULL,
      chapterUid INTEGER NOT NULL DEFAULT 0,
      markText TEXT NOT NULL DEFAULT '',
      createTime INTEGER NOT NULL DEFAULT 0,
      type INTEGER NOT NULL DEFAULT 0,
      range TEXT NOT NULL DEFAULT '',
      colorStyle INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(bookId)');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chapters (
      bookId TEXT NOT NULL,
      chapterUid INTEGER NOT NULL,
      chapterIdx INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (bookId, chapterUid)
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reviews (
      reviewId TEXT PRIMARY KEY,
      bookId TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      htmlContent TEXT,
      createTime INTEGER NOT NULL DEFAULT 0,
      star INTEGER NOT NULL DEFAULT 0,
      chapterName TEXT,
      abstract TEXT,
      type INTEGER,
      likesCount INTEGER,
      range TEXT
    )
  `);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_reviews_book ON reviews(bookId)');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS stats_snapshots (
      date TEXT PRIMARY KEY,
      totalReadTime INTEGER NOT NULL DEFAULT 0,
      readDays INTEGER NOT NULL DEFAULT 0,
      bookCount INTEGER NOT NULL DEFAULT 0,
      finishedCount INTEGER NOT NULL DEFAULT 0,
      noteTotal INTEGER NOT NULL DEFAULT 0
    )
  `);
  await ensureFts(db);
  await db.execute('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [
    'schema_version',
    String(SCHEMA_VERSION),
  ]);
}

async function ensureFts(db: Database): Promise<void> {
  // FTS5 默认分词器不切分中文，召回不全，已改用 LIKE 查询（见 ftsSearch）。
  // 保留建表仅为兼容已存在这些表的旧库；新同步不再写入 FTS 数据。
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
      markText, content='bookmarks', content_rowid='rowid'
    )
  `);
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS reviews_fts USING fts5(
      content, content='reviews', content_rowid='rowid'
    )
  `);
}

// ============ 同步 ============

export interface SyncProgress {
  done: number;
  total: number;
  phase: 'books' | 'contents';
}

const SYNC_CONCURRENCY = 10;

/**
 * 全量同步：书架 + 笔记列表落 books 表，再逐书拉划线/想法/书评落明细表，
 * 最后写统计快照与 FTS 索引。每本书一个事务（先删旧再插），远端删除能正确反映。
 */
export async function syncAll(onProgress?: (p: SyncProgress) => void): Promise<void> {
  const db = await getDb();

  // 1. 书架 + 笔记列表 → books
  onProgress?.({ done: 0, total: 0, phase: 'books' });
  const [shelf, notebooks] = await Promise.all([
    fetchShelf().catch(() => null),
    fetchAllNotebooks(),
  ]);

  const bookRows = new Map<string, Record<string, unknown>>();
  (shelf?.books || []).forEach(b => {
    bookRows.set(b.bookId, {
      bookId: b.bookId, title: b.title || '', author: b.author || '', cover: b.cover || '',
      category: b.category || '', readUpdateTime: b.readUpdateTime || 0,
      finishReading: b.finishReading || 0, markedStatus: 0,
      noteCount: 0, reviewCount: 0, bookmarkCount: 0, readingProgress: 0, sort: 0,
      updatedAt: Math.floor(Date.now() / 1000),
    });
  });
  (notebooks.books || []).forEach(nb => {
    if (!nb.book) return;
    const prev = bookRows.get(nb.bookId) || {};
    bookRows.set(nb.bookId, {
      ...prev,
      bookId: nb.bookId,
      title: nb.book.title || '', author: nb.book.author || '', cover: nb.book.cover || '',
      category: nb.book.category || '', readUpdateTime: nb.book.readUpdateTime || 0,
      finishReading: nb.book.finishReading || 0,
      markedStatus: nb.markedStatus || 0,
      noteCount: nb.noteCount || 0, reviewCount: nb.reviewCount || 0,
      bookmarkCount: nb.bookmarkCount || 0,
      readingProgress: nb.readingProgress || 0, sort: nb.sort || 0,
      updatedAt: Math.floor(Date.now() / 1000),
    });
  });

  for (const row of bookRows.values()) {
    await db.execute(
      `INSERT OR REPLACE INTO books (bookId, title, author, cover, category, readUpdateTime,
        finishReading, markedStatus, noteCount, reviewCount, bookmarkCount, readingProgress, sort, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.bookId, row.title, row.author, row.cover, row.category, row.readUpdateTime,
       row.finishReading, row.markedStatus, row.noteCount, row.reviewCount,
       row.bookmarkCount, row.readingProgress, row.sort, row.updatedAt],
    );
  }

  // 2. 逐书同步划线/想法/书评
  const targets = (notebooks.books || []).filter(nb => nb.book?.bookId);
  let done = 0;
  onProgress?.({ done: 0, total: targets.length, phase: 'contents' });

  for (let i = 0; i < targets.length; i += SYNC_CONCURRENCY) {
    const chunk = targets.slice(i, i + SYNC_CONCURRENCY);
    await Promise.all(chunk.map(async (nb) => {
      const bookId = nb.book!.bookId;
      try {
        const [bmData, rvData] = await Promise.all([
          fetchBookmarks(bookId),
          fetchBookReviews(bookId),
        ]);
        await syncBookContents(db, bookId, bmData.updated || [], bmData.chapters || [], rvData.reviews || []);
      } catch (err) {
        console.warn(`[sync] 书籍 ${nb.book!.title} 同步失败，跳过：`, err);
      } finally {
        done++;
        onProgress?.({ done, total: targets.length, phase: 'contents' });
      }
    }));
  }

  // 3. 统计快照 + FTS + lastSyncAt
  try {
    const stats = await fetchReadingStats('overall');
    const finishedRow = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) as c FROM books WHERE markedStatus = 4',
    );
    await db.execute(
      'INSERT OR REPLACE INTO stats_snapshots (date, totalReadTime, readDays, bookCount, finishedCount, noteTotal) VALUES (?, ?, ?, ?, ?, ?)',
      [new Date().toISOString().slice(0, 10), stats.totalReadTime || 0, stats.readDays || 0,
       bookRows.size, finishedRow[0]?.c || 0,
       (notebooks.books || []).reduce((s, nb) => s + nb.noteCount + nb.reviewCount + nb.bookmarkCount, 0)],
    );
  } catch (err) {
    console.warn('[sync] 统计快照写入失败（不影响主同步）：', err);
  }

  await db.execute('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [
    'lastSyncAt',
    String(Math.floor(Date.now() / 1000)),
  ]);
}

async function syncBookContents(
  db: Database,
  bookId: string,
  bookmarks: BookmarkItem[],
  chapters: ChapterItem[],
  reviews: ReviewItem[],
): Promise<void> {
  // 注意：tauri-plugin-sql 底层是连接池，BEGIN/COMMIT 分开执行不可靠，
  // 这里不做显式事务；单本书写坏的场景由下次全量同步自愈。
  await db.execute('DELETE FROM bookmarks WHERE bookId = ?', [bookId]);
  await db.execute('DELETE FROM reviews WHERE bookId = ?', [bookId]);
  await db.execute('DELETE FROM chapters WHERE bookId = ?', [bookId]);

  for (const bm of bookmarks) {
    await db.execute(
      `INSERT OR REPLACE INTO bookmarks (bookmarkId, bookId, chapterUid, markText, createTime, type, range, colorStyle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [bm.bookmarkId, bookId, bm.chapterUid ?? 0, bm.markText || '',
       bm.createTime || 0, bm.type ?? 0, bm.range || '', bm.colorStyle ?? 0],
    );
  }
  for (const ch of chapters) {
    await db.execute(
      `INSERT OR REPLACE INTO chapters (bookId, chapterUid, chapterIdx, title) VALUES (?, ?, ?, ?)`,
      [bookId, ch.chapterUid, ch.chapterIdx ?? 0, ch.title || ''],
    );
  }
  for (const rv of reviews) {
    await db.execute(
      `INSERT OR REPLACE INTO reviews (reviewId, bookId, content, htmlContent, createTime, star, chapterName, abstract, type, likesCount, range)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [rv.review.reviewId, bookId, rv.review.content || '', rv.review.htmlContent ?? null,
       rv.review.createTime || 0, rv.review.star ?? 0, rv.review.chapterName ?? null,
       rv.review.abstract ?? null, rv.review.type ?? null, rv.likesCount ?? null,
       rv.review.range ?? null],
    );
  }
}

// ============ 查询 ============

interface BookRow {
  bookId: string; title: string; author: string; cover: string; category: string;
  readUpdateTime: number; finishReading: number; markedStatus: number;
  noteCount: number; reviewCount: number; bookmarkCount: number;
  readingProgress: number; sort: number;
}

function rowToBookItem(row: BookRow): BookItem {
  return {
    bookId: row.bookId, title: row.title, author: row.author, cover: row.cover,
    category: row.category, readUpdateTime: row.readUpdateTime,
    finishReading: row.finishReading, updateTime: row.readUpdateTime, isTop: 0, secret: 0,
  };
}

function rowToNotebookItem(row: BookRow): NotebookItem {
  return {
    bookId: row.bookId,
    book: rowToBookItem(row),
    reviewCount: row.reviewCount, noteCount: row.noteCount, bookmarkCount: row.bookmarkCount,
    readingProgress: row.readingProgress, markedStatus: row.markedStatus, sort: row.sort,
  };
}

export async function hasLocalData(): Promise<boolean> {
  if (!isTauri) return false;
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      'SELECT value FROM sync_meta WHERE key = ?', ['lastSyncAt'],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function getLastSyncAt(): Promise<number | null> {
  if (!isTauri) return null;
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      'SELECT value FROM sync_meta WHERE key = ?', ['lastSyncAt'],
    );
    return rows.length > 0 ? parseInt(rows[0].value, 10) : null;
  } catch {
    return null;
  }
}

export interface LocalStats {
  bookCount: number;
  noteBookCount: number;
  bookmarkCount: number;
  reviewCount: number;
}

export async function getLocalStats(): Promise<LocalStats | null> {
  if (!isTauri) return null;
  try {
    const db = await getDb();
    const [books, bms, rvs] = await Promise.all([
      db.select<{ c: number }[]>('SELECT COUNT(*) as c FROM books'),
      db.select<{ c: number }[]>('SELECT COUNT(*) as c FROM bookmarks'),
      db.select<{ c: number }[]>('SELECT COUNT(*) as c FROM reviews'),
    ]);
    const noteBooks = await db.select<{ c: number }[]>(
      'SELECT COUNT(*) as c FROM books WHERE noteCount > 0 OR reviewCount > 0',
    );
    return {
      bookCount: books[0]?.c || 0,
      noteBookCount: noteBooks[0]?.c || 0,
      bookmarkCount: bms[0]?.c || 0,
      reviewCount: rvs[0]?.c || 0,
    };
  } catch {
    return null;
  }
}

/** 本地查询笔记书列表（对齐 fetchAllNotebooks 的返回结构） */
export async function queryNotebooks(): Promise<NotebookItem[]> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>(
    'SELECT * FROM books WHERE noteCount > 0 OR reviewCount > 0 ORDER BY sort DESC',
  );
  return rows.map(rowToNotebookItem);
}

/** 本地查询书架全部书（对齐 fetchShelf 的书列表） */
export async function queryShelfBooks(): Promise<BookItem[]> {
  const db = await getDb();
  const rows = await db.select<BookRow[]>('SELECT * FROM books ORDER BY readUpdateTime DESC');
  return rows.map(rowToBookItem);
}

export interface BookDetailResult {
  bookmarks: BookmarkItem[];
  chapters: ChapterItem[];
  reviews: ReviewItem[];
}

/** 本地查询单本书的划线/章节/想法+书评 */
export async function queryBookDetail(bookId: string): Promise<BookDetailResult> {
  const db = await getDb();
  const [bmRows, chRows, rvRows] = await Promise.all([
    db.select<{ [k: string]: unknown }[]>(
      'SELECT * FROM bookmarks WHERE bookId = ? ORDER BY createTime ASC', [bookId]),
    db.select<{ [k: string]: unknown }[]>(
      'SELECT * FROM chapters WHERE bookId = ? ORDER BY chapterIdx ASC', [bookId]),
    db.select<{ [k: string]: unknown }[]>(
      'SELECT * FROM reviews WHERE bookId = ? ORDER BY createTime ASC', [bookId]),
  ]);

  const bookmarks: BookmarkItem[] = bmRows.map(r => ({
    bookmarkId: String(r.bookmarkId), bookId: String(r.bookId),
    chapterUid: Number(r.chapterUid), markText: String(r.markText || ''),
    createTime: Number(r.createTime || 0), type: Number(r.type || 0),
    range: String(r.range || ''), colorStyle: Number(r.colorStyle || 0),
  }));
  const chapters: ChapterItem[] = chRows.map(r => ({
    chapterUid: Number(r.chapterUid), chapterIdx: Number(r.chapterIdx || 0),
    title: String(r.title || ''),
  }));
  const reviews: ReviewItem[] = rvRows.map(r => ({
    likesCount: r.likesCount == null ? undefined : Number(r.likesCount),
    review: {
      reviewId: String(r.reviewId), content: String(r.content || ''),
      htmlContent: r.htmlContent == null ? undefined : String(r.htmlContent),
      createTime: Number(r.createTime || 0), star: Number(r.star || 0),
      chapterName: r.chapterName == null ? undefined : String(r.chapterName),
      abstract: r.abstract == null ? undefined : String(r.abstract),
      range: r.range == null ? undefined : String(r.range),
      chapterUid: r.chapterUid == null ? undefined : Number(r.chapterUid),
      type: r.type == null ? undefined : Number(r.type),
    },
  }));
  return { bookmarks, chapters, reviews };
}

export interface TopReviewItem {
  reviewId: string;
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  bookCover: string;
  content: string;
  htmlContent?: string;
  createTime: number;
  likesCount: number;
  /** 4=书评，其余为想法 */
  type: number | null;
  chapterName?: string;
}

/** 本地点赞排行：想法+书评按 likesCount 降序 */
export async function queryTopReviews(limit = 200): Promise<TopReviewItem[]> {
  const db = await getDb();
  const rows = await db.select<{ [k: string]: unknown }[]>(
    `SELECT r.reviewId, r.bookId, r.content, r.htmlContent, r.createTime, r.likesCount, r.type, r.chapterName,
            b.title AS bookTitle, b.author AS bookAuthor, b.cover AS bookCover
     FROM reviews r JOIN books b ON b.bookId = r.bookId
     WHERE r.likesCount > 0
     ORDER BY r.likesCount DESC, r.createTime DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map(r => ({
    reviewId: String(r.reviewId),
    bookId: String(r.bookId),
    bookTitle: String(r.bookTitle || ''),
    bookAuthor: String(r.bookAuthor || ''),
    bookCover: String(r.bookCover || ''),
    content: String(r.content || ''),
    htmlContent: r.htmlContent == null ? undefined : String(r.htmlContent),
    createTime: Number(r.createTime || 0),
    likesCount: Number(r.likesCount || 0),
    type: r.type == null ? null : Number(r.type),
    chapterName: r.chapterName == null ? undefined : String(r.chapterName),
  }));
}

/** 本地查询某本书是否含书评（type=4），用于书架卡片 ⭐ 徽章 */
export async function queryHasBookReview(bookId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ c: number }[]>(
    'SELECT COUNT(*) as c FROM reviews WHERE bookId = ? AND type = 4', [bookId]);
  return (rows[0]?.c || 0) > 0;
}

export interface LocalSearchResult {
  kind: 'highlight' | 'thought';
  book: BookItem;
  targetId: string;
  content: string;
  createTime: number;
  chapterName?: string;
}

/**
 * 本地全文搜索：划线 + 想法/书评内容。
 * 注意：FTS5 默认分词器不切分中文（整句一个 token），中文召回严重不全，
 * 本地数据量小（万级），LIKE 子串匹配几毫秒出结果且召回完整，故弃用 FTS。
 */
export async function ftsSearch(keyword: string, limit = 500): Promise<LocalSearchResult[]> {
  const db = await getDb();
  const kw = keyword.trim();
  if (!kw) return [];
  const escaped = kw.replace(/[\\%_]/g, m => `\\${m}`);
  const pattern = `%${escaped}%`;

  const [bmHits, rvHits] = await Promise.all([
    db.select<{ [k: string]: unknown }[]>(
      `SELECT b.bookId, b.title, b.author, b.cover, b.category, b.readUpdateTime, b.finishReading,
              bm.bookmarkId, bm.markText, bm.createTime, bm.chapterUid,
              (SELECT title FROM chapters c WHERE c.bookId = bm.bookId AND c.chapterUid = bm.chapterUid) AS chapterName
       FROM bookmarks bm JOIN books b ON b.bookId = bm.bookId
       WHERE bm.markText LIKE ? ESCAPE '\\'
       ORDER BY bm.createTime DESC LIMIT ?`,
      [pattern, limit]),
    db.select<{ [k: string]: unknown }[]>(
      `SELECT b.bookId, b.title, b.author, b.cover, b.category, b.readUpdateTime, b.finishReading,
              r.reviewId, r.content, r.createTime, r.chapterName, r.type
       FROM reviews r JOIN books b ON b.bookId = r.bookId
       WHERE r.content LIKE ? ESCAPE '\\'
       ORDER BY r.createTime DESC LIMIT ?`,
      [pattern, limit]),
  ]);

  const toBook = (r: { [k: string]: unknown }): BookItem => ({
    bookId: String(r.bookId), title: String(r.title || ''), author: String(r.author || ''),
    cover: String(r.cover || ''), category: String(r.category || ''),
    readUpdateTime: Number(r.readUpdateTime || 0), finishReading: Number(r.finishReading || 0),
    updateTime: Number(r.readUpdateTime || 0), isTop: 0, secret: 0,
  });

  const results: LocalSearchResult[] = [
    ...bmHits.map(r => ({
      kind: 'highlight' as const,
      book: toBook(r),
      targetId: String(r.bookmarkId),
      content: String(r.markText || ''),
      createTime: Number(r.createTime || 0),
      chapterName: r.chapterName == null ? undefined : String(r.chapterName),
    })),
    ...rvHits.map(r => ({
      kind: 'thought' as const,
      book: toBook(r),
      targetId: String(r.reviewId),
      content: String(r.content || ''),
      createTime: Number(r.createTime || 0),
      chapterName: r.chapterName == null ? undefined : String(r.chapterName),
    })),
  ];
  results.sort((a, b) => b.createTime - a.createTime);
  return results;
}
