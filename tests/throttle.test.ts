/**
 * weread.ts 频控治理单测：全局并发/配速、退避重试（5/15/30s）、
 * 连续 5 次熔断 90s 冷却、成功重置连击、非频控错误不重试。
 * mock 全局 fetch + fake timers；每次用例 vi.resetModules 清模块级连击/配速状态。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function okBody(data: unknown) {
  return { ok: true, json: async () => data } as unknown as Response;
}
function throttledBody() {
  // 网关频控形态：HTTP 403 + body errcode -2014
  return {
    ok: false,
    status: 403,
    clone() { return this; },
    json: async () => ({ errcode: -2014, errmsg: '请求频率超限' }),
  } as unknown as Response;
}

/** 动态加载 weread 模块（resetModules 后重新初始化模块级限速状态） */
async function loadWeread() {
  const mod = await import('../src/services/weread');
  return mod;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('全局并发与配速', () => {
  it('并发上限 6：10 个并发请求峰值同时活跃 ≤ 6', async () => {
    const { setApiKey, fetchShelf } = await loadWeread();
    setApiKey('wrk-test');

    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 50)); // 模拟请求耗时
      active--;
      return okBody({ books: [] });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const jobs = Array.from({ length: 10 }, () => fetchShelf());
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(jobs);
    expect(peak).toBeLessThanOrEqual(6);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('全局配速：任意 150ms 窗口内新发起的请求 ≤ 6 个', async () => {
    const { setApiKey, fetchShelf } = await loadWeread();
    setApiKey('wrk-test');

    // 实现语义：首批（≤并发上限 6）同批放行，后续新请求在上次发起 150ms 后放行
    const starts: number[] = [];
    const fetchMock = vi.fn(async () => {
      starts.push(Date.now());
      return okBody({ books: [] });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const jobs = Array.from({ length: 13 }, () => fetchShelf());
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.all(jobs);
    expect(starts.length).toBe(13);
    // 按 150ms 分桶，每桶开始数 ≤ 6
    const buckets = new Map<number, number>();
    starts.forEach(t => {
      const b = Math.floor(t / 150);
      buckets.set(b, (buckets.get(b) || 0) + 1);
    });
    for (const [bucket, count] of buckets) {
      expect(count, `150ms 桶 ${bucket} 放行 ${count} 个`).toBeLessThanOrEqual(6);
    }
  });
});

describe('频控退避（ThrottledError）', () => {
  it('首次频控后 5s 退避重试成功，恢复事件触发', async () => {
    const { setApiKey, fetchShelf } = await loadWeread();
    setApiKey('wrk-test');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(throttledBody())
      .mockResolvedValueOnce(okBody({ books: [] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const events: string[] = [];
    window.addEventListener('weread-throttled', () => events.push('throttled'));
    window.addEventListener('weread-throttled-recovered', () => events.push('recovered'));

    const job = fetchShelf();
    // 推进 5s 退避
    await vi.advanceTimersByTimeAsync(5000);
    const result = await job;

    expect(result.books).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toContain('throttled');
    expect(events).toContain('recovered');
  });

  it('三轮退避（5/15/30s）全部失败后抛 ThrottledError', async () => {
    const { setApiKey, fetchShelf, ThrottledError } = await loadWeread();
    setApiKey('wrk-test');

    const fetchMock = vi.fn(async () => throttledBody());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const job = fetchShelf();
    const assertion = expect(job).rejects.toThrow(ThrottledError);
    await vi.advanceTimersByTimeAsync(5000 + 15000 + 30000);
    await assertion;
    // 初次 + 三轮退避 = 4 次请求；4 次连击 < 5 不触发熔断
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('非频控业务错误（errcode -1）直接抛出不重试', async () => {
    const { setApiKey, fetchShelf } = await loadWeread();
    setApiKey('wrk-test');

    const fetchMock = vi.fn(async () => okBody({ errcode: -1, errmsg: '参数错误' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchShelf()).rejects.toThrow('参数错误');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('连续频控熔断', () => {
  it('连续 5 次频控触发 90s 整体冷却后继续重试', async () => {
    const { setApiKey, fetchShelf, ThrottledError } = await loadWeread();
    setApiKey('wrk-test');

    const fetchMock = vi.fn(async () => throttledBody());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const spy = vi.spyOn(globalThis, 'setTimeout');

    // 第一个 callApi：4 次请求全频控（连击 4，未到 5 不熔断）
    const job1 = fetchShelf();
    const a1 = expect(job1).rejects.toThrow(ThrottledError);
    await vi.advanceTimersByTimeAsync(5000 + 15000 + 30000);
    await a1;
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // 第二个 callApi：第 1 次频控即连击 5 → 熔断 90s，随后继续退避重试
    const job2 = fetchShelf();
    const a2 = expect(job2).rejects.toThrow(ThrottledError);
    await vi.runAllTimersAsync(); // 推进熔断 90s + 后续退避直至 settle
    await a2;

    // 熔断定时器 90000ms 被调度过
    const delays = spy.mock.calls.map(c => c[1]).filter((d): d is number => typeof d === 'number' && d > 60_000);
    expect(delays).toContain(90_000);
    spy.mockRestore();
  });

  it('成功会重置连击：4 次频控 + 1 次成功 + 再频控不触发熔断', async () => {
    const { setApiKey, fetchShelf } = await loadWeread();
    setApiKey('wrk-test');

    const responses = [
      throttledBody(), throttledBody(), throttledBody(),
      okBody({ books: [] }), // 第 4 次请求（退避后）成功 → 连击清零
      throttledBody(),       // 新一轮第 1 次频控 → 连击 1，不熔断
      okBody({ books: [] }),
    ];
    let i = 0;
    const fetchMock = vi.fn(async () => {
      const r = responses[i++];
      if (!r) throw new Error('测试响应序列耗尽');
      return r;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const spy = vi.spyOn(globalThis, 'setTimeout');

    const job1 = fetchShelf();
    const a1 = job1.then(r => expect(r.books).toEqual([]));
    await vi.advanceTimersByTimeAsync(5000 + 15000 + 30000); // 3 轮退避后的第 4 次请求成功
    await a1;
    expect(fetchMock).toHaveBeenCalledTimes(4); // 3 失败 + 1 成功

    const job2 = fetchShelf();
    const a2 = job2.then(r => expect(r.books).toEqual([]));
    await vi.advanceTimersByTimeAsync(10_000);
    await a2;
    expect(fetchMock).toHaveBeenCalledTimes(6); // job1 4 次（3 败 1 成）+ job2 2 次

    // 从未出现 90s 级别的冷却定时器
    const delays = spy.mock.calls.map(c => c[1]).filter((d): d is number => typeof d === 'number');
    expect(delays.every(d => d <= 30_000)).toBe(true);
    spy.mockRestore();
  });
});
