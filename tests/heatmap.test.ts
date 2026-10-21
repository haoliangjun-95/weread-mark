/**
 * 活跃热力图纯函数单测：sqrt 强度分级、年历网格（周一基、闰年、边界占位、月份标签）。
 */
import { describe, it, expect } from 'vitest';
import { intensityOf, buildYearGrid, mergeReadTimesToDaily } from '../src/utils/heatmap';

describe('intensityOf 强度分级', () => {
  it('0 与负值返回 0（无数据）', () => {
    expect(intensityOf(0, 10)).toBe(0);
    expect(intensityOf(-1, 10)).toBe(0);
  });

  it('max 为 0 时返回 0（全空年）', () => {
    expect(intensityOf(5, 0)).toBe(0);
  });

  it('任意正量至少 1 档', () => {
    expect(intensityOf(1, 1000)).toBe(1);
  });

  it('等于最大值为 4 档，sqrt 归一化中间值', () => {
    expect(intensityOf(10, 10)).toBe(4);
    // sqrt(0.25)=0.5 → ceil(2)=2
    expect(intensityOf(2.5, 10)).toBe(2);
    // sqrt(0.64)=0.8 → ceil(3.2)=4（保持 Obsidian 脚本行为）
    expect(intensityOf(6.4, 10)).toBe(4);
  });
});

describe('buildYearGrid 年历网格', () => {
  it('2026 常规年：周数 53（1 月 1 日周四起始）且格子数覆盖全年', () => {
    const grid = buildYearGrid(2026);
    expect(grid.weeks.length).toBeGreaterThanOrEqual(52);
    expect(grid.weeks.length).toBeLessThanOrEqual(53);
    const dates = grid.weeks.flat().filter(c => c.date).map(c => c.date!);
    expect(dates.length).toBe(365);
    expect(dates[0]).toBe('2026-01-01');
    expect(dates[dates.length - 1]).toBe('2026-12-31');
  });

  it('2024 闰年：366 天完整覆盖', () => {
    const dates = buildYearGrid(2024).weeks.flat().filter(c => c.date).map(c => c.date!);
    expect(dates.length).toBe(366);
    expect(dates).toContain('2024-02-29');
  });

  it('周一是每列第一行（周一基）', () => {
    // 2026-01-01 是周四：第一列应为 [null,null,null,'2026-01-01','2026-01-02','2026-01-03','2026-01-04']
    const grid = buildYearGrid(2026);
    expect(grid.weeks[0].map(c => c.date)).toEqual([
      null, null, null, '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
    ]);
  });

  it('key 与 date 对应（M-D 无前导零，与 queryDayCounts 一致）', () => {
    const grid = buildYearGrid(2026);
    const cell = grid.weeks[0][3];
    expect(cell.date).toBe('2026-01-01');
    expect(cell.key).toBe('1-1');
  });

  it('月份标签 12 个且按列递增', () => {
    const { monthLabels } = buildYearGrid(2025);
    expect(monthLabels.length).toBe(12);
    for (let i = 1; i < monthLabels.length; i++) {
      expect(monthLabels[i].col).toBeGreaterThan(monthLabels[i - 1].col);
    }
    expect(monthLabels[0].label).toBe('1月');
    expect(monthLabels[11].label).toBe('12月');
  });

  it('非本年日期为占位（跨年首尾周不产生键）', () => {
    const grid = buildYearGrid(2023); // 2023-01-01 周日 → 首列 6 个占位
    expect(grid.weeks[0].slice(0, 6).every(c => c.date === null && c.key === null)).toBe(true);
    expect(grid.weeks[0][6].date).toBe('2023-01-01');
  });
});

describe('mergeReadTimesToDaily 逐月 readTimes 合并', () => {
  const ts = (y: number, m: number, d: number, h = 12) =>
    Math.floor(new Date(y, m - 1, d, h).getTime() / 1000).toString();

  it('逐日聚合并秒转分钟（键 M-D 无前导零）', () => {
    const daily = mergeReadTimesToDaily([
      { [ts(2026, 1, 5)]: 3600, [ts(2026, 1, 5, 20)]: 1800, [ts(2026, 1, 31)]: 600 },
      { [ts(2026, 2, 1)]: 120 },
    ], 2026);
    expect(daily['1-5']).toBe(90);
    expect(daily['1-31']).toBe(10);
    expect(daily['2-1']).toBe(2);
  });

  it('过滤非目标年份与零值', () => {
    const daily = mergeReadTimesToDaily([
      { [ts(2025, 1, 5)]: 3600, [ts(2026, 3, 1)]: 0, [ts(2026, 3, 2)]: 300 },
    ], 2026);
    expect(Object.keys(daily)).toEqual(['3-2']);
  });
});
