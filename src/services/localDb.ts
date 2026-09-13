import {
  fetchShelf,
  fetchAllNotebooks,
  fetchBookmarks,
  fetchAllBookReviews,
  fetchReadingStats,
} from './weread';
import { isTauri, isCapacitor, isHarmony, isNativeApp } from './dbInterface';
import type {
  BookItem,
  NotebookItem,
  BookmarkItem,
  ChapterItem,
  ReviewItem,
} from '../types/weread';

export { isTauri, isCapacitor, isHarmony, isNativeApp };

/** localDb 仅在原生环境可用（tauri 桌面 / capacitor 移动 / harmony 鸿蒙） */
const isNativeDb = isTauri || isCapacitor || isHarmony;

const DB_FILE_NAME = 'weread.db';
const DB_CONN_NAME = 'weread';
const CUSTOM_DB_DIR_KEY = 'weread-db-dir';
const SCHEMA_VERSION = 2;

/**
 * 统一数据库连接接口：抹平 tauri-plugin-sql 与 @capacitor-community/sqlite 的 API 差异。
 * - tauri: execute(sql, params?) / select<T>(sql, params?)
 * - capacitor: run(sql, params?) 返回变更数 / query(sql, params?) 返回 { values }
 */
interface DbConnection {
  execute(query: string, params?: unknown[]): Promise<unknown>;
  select<T>(query: string, params?: unknown[]): Promise<T[]>;
  /** 可选：关闭连接（切换存储目录时使用） */
  close?(): Promise<void>;
}

let dbPromise: Promise<DbConnection> | null = null;

/** 自定义存储目录（localStorage 持久化；必须在 load 之前可知，故不能存进库里）。仅桌面支持。 */
function getCustomDbDir(): string | null {
  try {
    return localStorage.getItem(CUSTOM_DB_DIR_KEY) || null;
  } catch {
    return null;
  }
}

/** 目录 → sqlite 连接串（仅 tauri 插件使用）。
 *  绝对路径会整体替换插件的默认 App 目录（path_mapper 特性）；
 *  反斜杠归一为 /，按段 encodeURIComponent 保证中文目录名安全（sqlx 侧会解码）。 */
function toSqliteUrl(dir: string | null): string {
  if (!dir) return `sqlite:${DB_FILE_NAME}`;
  const norm = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  const encoded = norm.split('/').map(seg => encodeURIComponent(seg)).join('/');
  return `sqlite:/${encoded}/${DB_FILE_NAME}`;
}

function currentDbUrl(): string {
  return toSqliteUrl(getCustomDbDir());
}

/** tauri 实现：plugin-sql 的 Database 已满足接口形状 */
async function openTauriDb(): Promise<DbConnection> {
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const db = await Database.load(currentDbUrl());
  return {
    execute: (q, p) => db.execute(q, p),
    select: <T,>(q: string, p?: unknown[]) => db.select<T>(q, p),
    close: () => db.close().then(() => undefined),
  };
}

/** capacitor 实现：@capacitor-community/sqlite 的 run/query 适配为统一接口 */
async function openCapacitorDb(): Promise<DbConnection> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite');
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  const isEncrypted = false;
  const mode = 'no-encryption';
  const version = 1;
  const readonly = false;
  const conn = await sqlite.createConnection(DB_CONN_NAME, isEncrypted, mode, version, readonly);
  await conn.open().catch(async () => {
    // 已存在连接时 open 报错是幂等噪音，确认存活即可
    const ok = await sqlite.isConnection(DB_CONN_NAME, readonly);
    if (!ok) throw new Error('SQLite 连接打开失败');
  });
  return {
    async execute(query: string, params?: unknown[]) {
      const res = await conn.run(query, params ?? []);
      return res.changes;
    },
    async select<T>(query: string, params?: unknown[]): Promise<T[]> {
      const res = await conn.query(query, params ?? []);
      return (res.values ?? []) as T[];
    },
  };
}

/** 鸿蒙实现：ArkTS 侧 registerJavaScriptProxy 注入的原生桥，底层是 relationalStore */
interface HarmonyDbBridge {
  dbExecute(sql: string, params?: unknown[]): Promise<unknown>;
  dbSelect(sql: string, params?: unknown[]): Promise<unknown[]>;
}

async function openHarmonyDb(): Promise<DbConnection> {
  const bridge = (window as unknown as { HarmonyBridge: HarmonyDbBridge }).HarmonyBridge;
  if (!bridge?.dbExecute || !bridge?.dbSelect) {
    throw new Error('鸿蒙数据库桥未注入');
  }
  return {
    execute: (q, p) => bridge.dbExecute(q, p),
    select: <T,>(q: string, p?: unknown[]) => bridge.dbSelect(q, p) as Promise<T[]>,
  };
}

function getDb(): Promise<DbConnection> {
  if (!dbPromise) {
    const opener = isTauri ? openTauriDb() : isCapacitor ? openCapacitorDb() : openHarmonyDb();
    dbPromise = opener.then(async (db) => {
      await migrate(db);
      return db;
    });
    // 失败时清除缓存，否则一次失败后（如权限问题）后续重试永远拿到同一个 rejected promise
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function migrate(db: DbConnection): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  const versionRow = await db.select<{ value: string }>(
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
      updatedAt INTEGER NOT NULL DEFAULT 0,
      syncedAt INTEGER NOT NULL DEFAULT 0
    )
  `);
  // v1 库升级：补 syncedAt 列（v2 新增，用于逐书记录同步完整性）
  try {
    await db.execute('ALTER TABLE books ADD COLUMN syncedAt INTEGER NOT NULL DEFAULT 0');
  } catch {
    // 列已存在（新建库的 CREATE 已包含）
  }
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

async function ensureFts(db: DbConnection): Promise<void> {
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
 * 最后写统计快照。返回同步失败（重试后仍失败）的书数量。
 */
export interface SyncResult {
  /** 重试后仍失败的书数量 */
  failedCount: number;
  /** 本次实际拉取明细的书数量（增量同步时有变化的书 + 首次同步） */
  changedCount: number;
  /** 笔记书总数 */
  totalCount: number;
}

export async function syncAll(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  const db = await getDb();

  // 1. 书架 + 笔记列表 → books（先读旧库，用于增量判断和保留 syncedAt）
  onProgress?.({ done: 0, total: 0, phase: 'books' });
  const [shelf, notebooks] = await Promise.all([
    fetchShelf().catch(() => null),
    fetchAllNotebooks(),
  ]);

  const existingRows = await db.select<{
    bookId: string; noteCount: number; reviewCount: number;
    bookmarkCount: number; markedStatus: number; syncedAt: number;
  }>('SELECT bookId, noteCount, reviewCount, bookmarkCount, markedStatus, syncedAt FROM books');
  const existing = new Map(existingRows.map(r => [r.bookId, r]));

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
        finishReading, markedStatus, noteCount, reviewCount, bookmarkCount, readingProgress, sort, updatedAt, syncedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.bookId, row.title, row.author, row.cover, row.category, row.readUpdateTime,
       row.finishReading, row.markedStatus, row.noteCount, row.reviewCount,
       row.bookmarkCount, row.readingProgress, row.sort, row.updatedAt,
       // 保留原 syncedAt：元数据刷新不能把"已同步完整"标记清掉
       existing.get(String(row.bookId))?.syncedAt ?? 0],
    );
  }

  // 远端已删除的书（不在书架也不在笔记列表）本地一并清掉
  const remoteIds = new Set(bookRows.keys());
  const removedIds = existingRows.map(r => r.bookId).filter(id => !remoteIds.has(id));
  for (const id of removedIds) {
    await db.execute('DELETE FROM books WHERE bookId = ?', [id]);
    await db.execute('DELETE FROM bookmarks WHERE bookId = ?', [id]);
    await db.execute('DELETE FROM reviews WHERE bookId = ?', [id]);
    await db.execute('DELETE FROM chapters WHERE bookId = ?', [id]);
  }

  // 2. 增量同步：仅拉取「新书 / 从未同步过 / 笔记计数或读完状态有变化 / 本地想法数少于线上」的书的明细。
  // 最后一个条件是自愈路径：历史版本曾因翻页缺陷只拉到第一页（计数比对不出差异），
  // 用本地 reviews 实际条数与线上 reviewCount 对账，缺的书自动重拉。
  const localReviewCounts = new Map(
    (await db.select<{ bookId: string; c: number }>(
      'SELECT bookId, COUNT(*) as c FROM reviews GROUP BY bookId')).map(r => [r.bookId, r.c]),
  );
  const allNotebookBooks = (notebooks.books || []).filter(nb => nb.book?.bookId);
  const targets = allNotebookBooks.filter(nb => {
    const prev = existing.get(nb.bookId);
    if (!prev || prev.syncedAt === 0) return true;
    if (prev.noteCount !== (nb.noteCount || 0)
      || prev.reviewCount !== (nb.reviewCount || 0)
      || prev.bookmarkCount !== (nb.bookmarkCount || 0)
      || prev.markedStatus !== (nb.markedStatus || 0)) return true;
    return (localReviewCounts.get(nb.bookId) || 0) < (nb.reviewCount || 0);
  });
  let done = 0;
  const failedBooks: typeof targets = [];
  onProgress?.({ done: 0, total: targets.length, phase: 'contents' });

  const syncOne = async (nb: (typeof targets)[number]) => {
    const bookId = nb.book!.bookId;
    const [bmData, allReviews] = await Promise.all([
      fetchBookmarks(bookId),
      fetchAllBookReviews(bookId),
    ]);
    // 完整性校验：拉到的想法/书评数少于线上 reviewCount 视为失败（计数不达标不标 syncedAt）
    if (allReviews.length < (nb.reviewCount || 0)) {
      throw new Error(`想法拉取不完整：${allReviews.length}/${nb.reviewCount}`);
    }
    await syncBookContents(db, bookId, bmData.updated || [], bmData.chapters || [], allReviews);
    // 逐书记录同步完成时间；失败的书保持 0，hasLocalData 据此判断库完整性
    await db.execute('UPDATE books SET syncedAt = ? WHERE bookId = ?', [
      Math.floor(Date.now() / 1000), bookId,
    ]);
  };

  for (let i = 0; i < targets.length; i += SYNC_CONCURRENCY) {
    const chunk = targets.slice(i, i + SYNC_CONCURRENCY);
    await Promise.all(chunk.map(async (nb) => {
      try {
        await syncOne(nb);
      } catch (err) {
        console.warn(`[sync] 书籍 ${nb.book!.title} 同步失败，待重试：`, err);
        failedBooks.push(nb);
      } finally {
        done++;
        onProgress?.({ done, total: targets.length, phase: 'contents' });
      }
    }));
  }

  // 失败的书串行重试一轮（往往是瞬时限流），仍失败的计入返回值
  if (failedBooks.length > 0) {
    console.warn(`[sync] ${failedBooks.length} 本书失败，开始重试`);
    const retry = [...failedBooks];
    failedBooks.length = 0;
    for (const nb of retry) {
      try {
        await syncOne(nb);
      } catch (err) {
        console.warn(`[sync] 书籍 ${nb.book!.title} 重试仍失败：`, err);
        failedBooks.push(nb);
      }
    }
  }

  // 3. 统计快照 + FTS + lastSyncAt
  try {
    const stats = await fetchReadingStats('overall');
    const finishedRow = await db.select<{ c: number }>(
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
  return { failedCount: failedBooks.length, changedCount: targets.length, totalCount: allNotebookBooks.length };
}

async function syncBookContents(
  db: DbConnection,
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
  if (!isNativeDb) return false;
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }>(
      'SELECT value FROM sync_meta WHERE key = ?', ['lastSyncAt'],
    );
    if (rows.length === 0) return false;
    // 同步不完整（有笔记的书未全部同步成功）时不视为可用本地库，读路径回退在线
    const missing = await db.select<{ c: number }>(
      'SELECT COUNT(*) as c FROM books WHERE (noteCount > 0 OR reviewCount > 0) AND syncedAt = 0',
    );
    return (missing[0]?.c || 0) === 0;
  } catch {
    return false;
  }
}

/** 同步状态：上次同步时间与未同步完成的笔记书数量（用于设置页提示） */
export async function getSyncStatus(): Promise<{ lastSyncAt: number | null; missingCount: number }> {
  if (!isNativeDb) return { lastSyncAt: null, missingCount: 0 };
  try {
    const db = await getDb();
    const [rows, missing] = await Promise.all([
      db.select<{ value: string }>("SELECT value FROM sync_meta WHERE key = 'lastSyncAt'"),
      db.select<{ c: number }>(
        'SELECT COUNT(*) as c FROM books WHERE (noteCount > 0 OR reviewCount > 0) AND syncedAt = 0'),
    ]);
    return {
      lastSyncAt: rows.length > 0 ? parseInt(rows[0].value, 10) : null,
      missingCount: missing[0]?.c || 0,
    };
  } catch {
    return { lastSyncAt: null, missingCount: 0 };
  }
}

/** 清空本地库全部数据（切换 API Key 时调用，避免读到上一个账号的数据） */
export async function resetLocalDb(): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM books');
  await db.execute('DELETE FROM bookmarks');
  await db.execute('DELETE FROM chapters');
  await db.execute('DELETE FROM reviews');
  await db.execute('DELETE FROM stats_snapshots');
  await db.execute("DELETE FROM sync_meta WHERE key = 'lastSyncAt'");
}

// ============ 存储目录 ============

export interface DbDirInfo {
  /** 自定义目录（未设置时为 null，即默认 App 数据目录） */
  customDir: string | null;
  /** 默认 App 数据目录绝对路径（Rust 命令提供） */
  defaultDir: string | null;
  /** 当前实际使用的数据库文件路径（展示用，编码还原后） */
  currentPath: string;
}

export async function getDbDirInfo(): Promise<DbDirInfo> {
  // 目录自定义仅桌面（Rust 命令）；移动端返回应用沙盒内的固定位置
  if (!isTauri) {
    return { customDir: null, defaultDir: null, currentPath: isNativeDb ? `${DB_CONN_NAME}（应用沙盒）` : '' };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const customDir = getCustomDbDir();
  const defaultDir = await invoke<string | null>('db_get_default_dir').catch(() => null);
  const dir = customDir ?? defaultDir;
  return {
    customDir,
    defaultDir,
    currentPath: dir ? `${dir}/${DB_FILE_NAME}` : DB_FILE_NAME,
  };
}

/**
 * 切换数据库存储目录：关闭旧连接 → 迁移数据库文件到新目录 → 切换并验证加载。
 * 失败时回滚到原目录并恢复连接。返回是否迁移了既有数据（false = 切到空目录，需重新同步）。
 * 仅桌面版支持（移动端应用沙盒不允许任意目录访问）。
 */
export async function changeDbDir(newDir: string | null): Promise<boolean> {
  if (!isTauri) {
    throw new Error('移动端不支持自定义存储目录');
  }
  const prevDir = getCustomDbDir();
  if ((prevDir ?? null) === (newDir ?? null)) return true;

  const { invoke } = await import('@tauri-apps/api/core');
  const defaultDir = await invoke<string>('db_get_default_dir');
  const oldDir = prevDir ?? defaultDir;

  // 关闭旧连接，清掉单例
  if (dbPromise) {
    const old = dbPromise;
    dbPromise = null;
    await old.then(db => db.close?.()).catch(() => undefined);
  }

  const apply = (dir: string | null) => {
    try {
      if (dir) localStorage.setItem(CUSTOM_DB_DIR_KEY, dir);
      else localStorage.removeItem(CUSTOM_DB_DIR_KEY);
    } catch { /* ignore */ }
  };

  try {
    // 迁移既有数据库文件（旧文件保留不删，便于手动回退）
    const migrated = await invoke<boolean>('db_prepare_and_copy', {
      srcFile: `${oldDir}/${DB_FILE_NAME}`,
      dstDir: newDir ?? defaultDir,
    });
    apply(newDir);
    await getDb(); // 验证新位置可加载
    return migrated;
  } catch (err) {
    // 回滚：恢复原目录配置与连接
    apply(prevDir);
    dbPromise = null;
    await getDb().catch(() => undefined);
    throw err;
  }
}

export async function getLastSyncAt(): Promise<number | null> {
  if (!isNativeDb) return null;
  try {
    const db = await getDb();
    const rows = await db.select<{ value: string }>(
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
  if (!isNativeDb) return null;
  try {
    const db = await getDb();
    const [books, bms, rvs] = await Promise.all([
      db.select<{ c: number }>('SELECT COUNT(*) as c FROM books'),
      db.select<{ c: number }>('SELECT COUNT(*) as c FROM bookmarks'),
      db.select<{ c: number }>('SELECT COUNT(*) as c FROM reviews'),
    ]);
    const noteBooks = await db.select<{ c: number }>(
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
  const rows = await db.select<BookRow>(
    'SELECT * FROM books WHERE noteCount > 0 OR reviewCount > 0 ORDER BY sort DESC',
  );
  return rows.map(rowToNotebookItem);
}

/** 本地查询书架全部书（对齐 fetchShelf 的书列表） */
export async function queryShelfBooks(): Promise<BookItem[]> {
  const db = await getDb();
  const rows = await db.select<BookRow>('SELECT * FROM books ORDER BY readUpdateTime DESC');
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
    db.select<{ [k: string]: unknown }>(
      'SELECT * FROM bookmarks WHERE bookId = ? ORDER BY createTime ASC', [bookId]),
    db.select<{ [k: string]: unknown }>(
      'SELECT * FROM chapters WHERE bookId = ? ORDER BY chapterIdx ASC', [bookId]),
    db.select<{ [k: string]: unknown }>(
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
  const rows = await db.select<{ [k: string]: unknown }>(
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

export interface OnThisDayItem {
  kind: 'highlight' | 'thought' | 'review';
  content: string;
  htmlContent?: string;
  createTime: number;
  targetId: string;
  book: BookItem;
}

/** 往年今天：历年同月同日的划线/想法/书评（纯本地查询，不做在线降级） */
export async function queryOnThisDay(limit = 500): Promise<OnThisDayItem[]> {
  const db = await getDb();
  const now = new Date();
  const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // SQL 只做年份粗筛（今年元旦之前的全部记录），月日匹配放 JS 端——
  // 避免 strftime 的 'localtime' 修饰符在各端 SQLite 编译选项下的兼容差异（华为 RDB 曾静默失败）
  const thisYearStart = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  const scanLimit = 5000; // 粗筛扫描上限

  const toBook = (r: { [k: string]: unknown }): BookItem => ({
    bookId: String(r.bookId), title: String(r.title || ''), author: String(r.author || ''),
    cover: String(r.cover || ''), category: String(r.category || ''),
    readUpdateTime: Number(r.readUpdateTime || 0), finishReading: Number(r.finishReading || 0),
    updateTime: Number(r.readUpdateTime || 0), isTop: 0, secret: 0,
  });

  const isOnThisDay = (ts: number): boolean => {
    const d = new Date(ts * 1000);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === monthDay;
  };

  const [bmHits, rvHits] = await Promise.all([
    db.select<{ [k: string]: unknown }>(
      `SELECT b.bookId, b.title, b.author, b.cover, b.category, b.readUpdateTime, b.finishReading,
              bm.bookmarkId, bm.markText, bm.createTime
       FROM bookmarks bm JOIN books b ON b.bookId = bm.bookId
       WHERE bm.createTime < ?
       ORDER BY bm.createTime DESC LIMIT ?`,
      [thisYearStart, scanLimit],
    ),
    db.select<{ [k: string]: unknown }>(
      `SELECT b.bookId, b.title, b.author, b.cover, b.category, b.readUpdateTime, b.finishReading,
              r.reviewId, r.content, r.htmlContent, r.createTime, r.type
       FROM reviews r JOIN books b ON b.bookId = r.bookId
       WHERE r.createTime < ?
       ORDER BY r.createTime DESC LIMIT ?`,
      [thisYearStart, scanLimit],
    ),
  ]);

  const items: OnThisDayItem[] = [
    ...bmHits
      .filter(r => isOnThisDay(Number(r.createTime || 0)))
      .map(r => ({
        kind: 'highlight' as const,
        content: String(r.markText || ''),
        createTime: Number(r.createTime || 0),
        targetId: String(r.bookmarkId),
        book: toBook(r),
      })),
    ...rvHits
      .filter(r => isOnThisDay(Number(r.createTime || 0)))
      .map(r => ({
        kind: (Number(r.type) === 4 ? 'review' : 'thought') as 'review' | 'thought',
        content: String(r.content || ''),
        htmlContent: r.htmlContent == null ? undefined : String(r.htmlContent),
        createTime: Number(r.createTime || 0),
        targetId: String(r.reviewId),
        book: toBook(r),
      })),
  ];
  items.sort((a, b) => b.createTime - a.createTime);
  return items.slice(0, limit);
}

/** 本地查询某本书是否含书评（type=4），用于书架卡片 ⭐ 徽章 */
export async function queryHasBookReview(bookId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ c: number }>(
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
    db.select<{ [k: string]: unknown }>(
      `SELECT b.bookId, b.title, b.author, b.cover, b.category, b.readUpdateTime, b.finishReading,
              bm.bookmarkId, bm.markText, bm.createTime, bm.chapterUid,
              (SELECT title FROM chapters c WHERE c.bookId = bm.bookId AND c.chapterUid = bm.chapterUid) AS chapterName
       FROM bookmarks bm JOIN books b ON b.bookId = bm.bookId
       WHERE bm.markText LIKE ? ESCAPE '\\'
       ORDER BY bm.createTime DESC LIMIT ?`,
      [pattern, limit]),
    db.select<{ [k: string]: unknown }>(
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
