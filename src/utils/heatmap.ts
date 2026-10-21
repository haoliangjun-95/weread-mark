/**
 * 热力图纯函数：强度分级与年历网格（GitHub contributions 布局，周一基）。
 * 独立于组件文件，便于单测与 fast refresh。
 */

/** sqrt 归一化到 1-4 档（0 表示无数据），与 Obsidian Heatmap Calendar 脚本一致 */
export function intensityOf(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(4 * Math.sqrt(n / max))));
}

export interface YearGridCell {
  /** 'YYYY-MM-DD'，null = 网格前后的占位（非本年日期） */
  date: string | null;
  /** 月-日 键（与 queryDayCounts 对齐，无前导零） */
  key: string | null;
}

export interface YearGrid {
  /** weeks[weekIdx][dayIdx]：dayIdx 0=周一 … 6=周日 */
  weeks: YearGridCell[][];
  /** 月份标签：第几列开始渲染哪个月 */
  monthLabels: Array<{ col: number; label: string }>;
}

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 生成年历网格：1 月 1 日所在周（周一起）到 12 月 31 日所在周 */
export function buildYearGrid(year: number): YearGrid {
  const pad = (v: number) => String(v).padStart(2, '0');
  const dayKey = (d: Date) => `${d.getMonth() + 1}-${d.getDate()}`;
  const dateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const first = new Date(year, 0, 1);
  const last = new Date(year, 11, 31);
  // JS getDay(): 0=周日；转周一基（0=周一）
  const mondayBase = (d: Date) => (d.getDay() + 6) % 7;
  const gridStart = new Date(year, 0, 1 - mondayBase(first));
  const totalDays = Math.round((last.getTime() - gridStart.getTime()) / 86400000) + 1;
  const weekCount = Math.ceil(totalDays / 7);

  const weeks: YearGridCell[][] = Array.from({ length: weekCount }, () =>
    Array.from({ length: 7 }, () => ({ date: null, key: null }) as YearGridCell));

  const monthLabels: Array<{ col: number; label: string }> = [];
  const cursor = new Date(gridStart);
  for (let i = 0; i < weekCount * 7; i++) {
    const inYear = cursor.getFullYear() === year;
    const week = Math.floor(i / 7);
    const day = i % 7;
    if (inYear) {
      weeks[week][day] = { date: dateStr(cursor), key: dayKey(cursor) };
      // 该月首次落进网格 → 挂标签（列需晚于已挂标签，避免重叠）
      const m = cursor.getMonth();
      if (!monthLabels.some(l => l.label === MONTH_LABELS[m])) {
        const col = day >= 6 && week + 1 < weekCount ? week + 1 : week;
        if (!monthLabels.some(l => l.col >= col)) {
          monthLabels.push({ col, label: MONTH_LABELS[m] });
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { weeks, monthLabels };
}
