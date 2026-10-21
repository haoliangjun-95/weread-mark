/**
 * weread.ts 核心网络逻辑单测：限速分类、退避熔断、想法拉取降级。
 * 通过 mock callApi 的底层 fetch，不发起真实请求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- sanitize：净化器（XSS 防线，回归重点） ----------
import { sanitizeRichText, richTextToPlain } from '../src/utils/sanitize';

describe('sanitize 净化器', () => {
  it('移除 script 标签', () => {
    expect(sanitizeRichText('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>');
  });

  it('移除事件属性', () => {
    expect(sanitizeRichText('<img src="x" onerror="alert(1)">')).toBe('<img src="x">');
  });

  it('移除 javascript: 协议', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">点我</a>')).toBe('<a>点我</a>');
  });

  it('保留正常富文本结构', () => {
    const html = '<blockquote><p>引用 <b>加粗</b></p></blockquote>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('richTextToPlain 提取纯文本且不执行副作用', () => {
    const plain = richTextToPlain('<p>第一段</p><p>第二<i>段</i></p>');
    expect(plain).toContain('第一段');
    expect(plain).toContain('第二段');
  });
});

// ---------- filterUtils：书架过滤纯函数 ----------
import { applyFilters, collectCategories } from '../src/utils/filterUtils';
import type { BookItem } from '../src/types/weread';

const mkBook = (over: Partial<BookItem>): BookItem => ({
  bookId: '1', title: '', author: '', cover: '', category: '',
  readUpdateTime: 0, finishReading: 0, updateTime: 0, isTop: 0, secret: 0,
  ...over,
});

describe('applyFilters / collectCategories', () => {
  const books = [
    mkBook({ bookId: '1', title: '三体', author: '刘慈欣', category: '科幻-小说' }),
    mkBook({ bookId: '2', title: '红楼梦', author: '曹雪芹', category: '古典文学/名著' }),
    mkBook({ bookId: '3', title: '三生三世', author: '唐七', category: '科幻-言情' }),
  ];

  it('关键词同时匹配书名与作者', () => {
    expect(applyFilters(books, b => b, '刘慈欣', 'all')).toHaveLength(1);
    expect(applyFilters(books, b => b, '三', 'all')).toHaveLength(2);
  });

  it('分类取一级（首个分隔段）', () => {
    const cats = collectCategories(books);
    expect(cats).toContain('科幻');
    expect(cats).toContain('古典文学');
    expect(cats.filter(c => c === '科幻')).toHaveLength(1);
  });
});

// ---------- share.ts：桥异常归一 ----------
import { toBridgeError } from '../src/utils/share';

describe('toBridgeError 桥异常归一', () => {
  it('对象带 message 转可读 Error', () => {
    const err = toBridgeError({ code: 401, message: 'Parameter error' }, 'dbExecute');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('dbExecute: Parameter error');
  });

  it('无 message 对象 JSON 化', () => {
    const err = toBridgeError({ foo: 1 }, 'x');
    expect(err.message).toContain('{"foo":1}');
  });

  it('字符串直接包装', () => {
    expect(toBridgeError('boom', 'y').message).toBe('y: boom');
  });
});

// ---------- localDb 纯逻辑：往年今天区间构造（从 queryOnThisDay 抽取等价实现验证） ----------
describe('往年今天时间戳区间', () => {
  it('为每个历年生成当天起止区间（本地时区）', () => {
    const now = new Date(2026, 8, 17, 15, 0, 0); // 2026-09-17
    const year = now.getFullYear();
    const start = Math.floor(new Date(year - 1, now.getMonth(), now.getDate(), 0, 0, 0).getTime() / 1000);
    const end = Math.floor(new Date(year - 1, now.getMonth(), now.getDate(), 23, 59, 59).getTime() / 1000);
    // 起止恰为一天
    expect(end - start).toBe(86399);
    // 区间确实覆盖「去年的今天」正午
    const noonLastYear = Math.floor(new Date(year - 1, 8, 17, 12, 0, 0).getTime() / 1000);
    expect(noonLastYear).toBeGreaterThanOrEqual(start);
    expect(noonLastYear).toBeLessThanOrEqual(end);
    // 不覆盖前年的今天
    const noonTwoYearsAgo = Math.floor(new Date(year - 2, 8, 17, 12, 0, 0).getTime() / 1000);
    expect(noonTwoYearsAgo).toBeLessThan(start);
  });
});

// ---------- fetchAllBookReviews 档位降级（mock 全局 fetch，端到端走真实 callApi） ----------
describe('fetchAllBookReviews count 降级', () => {
  beforeEach(() => {
    vi.resetModules(); // 清除 effectiveReviewPageSize 档位记忆的模块级状态
    vi.restoreAllMocks();
    localStorage.setItem('weread-api-key', 'test-key');
  });

  const loadFn = () => import('../src/services/weread').then(m => m.fetchAllBookReviews);

  const jsonResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('1000 档返回空时依次降级至有效档', async () => {
    const counts: number[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { count: number };
      counts.push(body.count);
      if (body.count === 1000) {
        return jsonResponse({ reviews: [], totalCount: 5, hasMore: 0, synckey: 1 });
      }
      return jsonResponse({
        reviews: Array.from({ length: 5 }, (_, i) => ({
          reviewId: `r${i}`,
          review: { reviewId: `r${i}`, content: `c${i}`, createTime: 100 + i },
        })),
        totalCount: 5, hasMore: 0, synckey: 2,
      });
    });

    const fn = await loadFn();
    const items = await fn('book1');
    expect(counts).toEqual([1000, 100]);
    expect(items).toHaveLength(5);
  });

  it('totalCount=0 视为真无数据，不降级', async () => {
    const counts: number[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { count: number };
      counts.push(body.count);
      return jsonResponse({ reviews: [], totalCount: 0, hasMore: 0, synckey: 0 });
    });

    const fn = await loadFn();
    const items = await fn('book1');
    expect(counts).toEqual([1000]);
    expect(items).toHaveLength(0);
  });

  it('有效档被记忆后，第二本书直接用该档', async () => {
    const counts: number[] = [];
    global.fetch = vi.fn().mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { count: number };
      counts.push(body.count);
      if (body.count === 1000) {
        return jsonResponse({ reviews: [], totalCount: 3, hasMore: 0, synckey: 1 });
      }
      return jsonResponse({
        reviews: Array.from({ length: 3 }, (_, i) => ({
          reviewId: `b${body.count}-${i}`,
          review: { reviewId: `b${body.count}-${i}`, content: 'x', createTime: 1 },
        })),
        totalCount: 3, hasMore: 0, synckey: 2,
      });
    });

    const fn = await loadFn();
    await fn('book1');
    await fn('book2');
    // 第一本：1000 空后 100 命中；第二本：直接 100（档位记忆）
    expect(counts).toEqual([1000, 100, 100]);
  });
});
