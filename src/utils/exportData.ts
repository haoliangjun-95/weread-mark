/**
 * 全库导出：JSON 备份（完整原始行）与 CSV（书目/划线/想法书评三张表）。
 * 仅本地库（原生端同步后可用）；产物经统一分享出口（Web 下载 / 原生分享面板）。
 */
import { queryAllForExport } from '../services/localDb';
import type { FullExportData } from '../services/localDb';
import { saveOrShareBlob } from './share';

/** CSV 字段转义：含逗号/引号/换行的值包引号，内部引号翻倍 */
export function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(header: string[], rows: unknown[][]): string {
  // \uFEFF BOM：让 Excel 正确识别 UTF-8 中文
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
}

function tsToDate(ts: unknown): string {
  const n = Number(ts);
  if (!n) return '';
  return new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/** 时间戳（秒）转本地日期字符串，空值给空串（CSV 友好） */
export function tsToLocalDate(ts: unknown): string {
  const n = Number(ts);
  if (!n) return '';
  const d = new Date(n * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function download(name: string, content: string, mime: string) {
  return saveOrShareBlob(new Blob([content], { type: `${mime};charset=utf-8` }), name);
}

/** 导出完整 JSON 备份 */
export async function exportAllJson(): Promise<void> {
  const data = await queryAllForExport();
  const json = JSON.stringify(data, null, 2);
  await download(`微痕-全库备份-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
}

/** 导出书目 CSV */
export async function exportBooksCsv(): Promise<number> {
  const data = await queryAllForExport();
  const csv = rowsToCsv(
    ['书名', '作者', '分类', '读完', '划线数', '想法/书评数', '阅读进度%', '最近阅读'],
    data.books.map(b => [
      b.title, b.author, b.category,
      Number(b.finishReading) === 1 ? '是' : '否',
      b.bookmarkCount, b.reviewCount,
      Math.round(Number(b.readingProgress || 0) * 100) / 100,
      tsToLocalDate(b.readUpdateTime),
    ]),
  );
  await download(`微痕-书目-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  return data.books.length;
}

/** 导出划线 CSV */
export async function exportBookmarksCsv(): Promise<number> {
  const data = await queryAllForExport();
  const titleById = new Map(data.books.map(b => [String(b.bookId), String(b.title || '')]));
  const csv = rowsToCsv(
    ['书名', '划线内容', '章节UID', '创建时间'],
    data.bookmarks.map(bm => [
      titleById.get(String(bm.bookId)) || '',
      bm.markText,
      bm.chapterUid,
      tsToLocalDate(bm.createTime),
    ]),
  );
  await download(`微痕-划线-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  return data.bookmarks.length;
}

/** 导出想法/书评 CSV */
export async function exportReviewsCsv(): Promise<number> {
  const data = await queryAllForExport();
  const titleById = new Map(data.books.map(b => [String(b.bookId), String(b.title || '')]));
  const csv = rowsToCsv(
    ['书名', '类型', '内容', '章节', '点赞数', '创建时间'],
    data.reviews.map(rv => [
      titleById.get(String(rv.bookId)) || '',
      Number(rv.type) === 4 ? '书评' : '想法',
      rv.htmlContent ? String(rv.htmlContent).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ') : rv.content,
      rv.chapterName,
      rv.likesCount,
      tsToLocalDate(rv.createTime),
    ]),
  );
  await download(`微痕-想法书评-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
  return data.reviews.length;
}

/** 供年报等复用的类型出口 */
export type { FullExportData };
export { tsToDate };
