/**
 * 可检索 PDF 导出：解析成书 HTML 的结构（.book-header/.section-title/.item），
 * 以真文字排版进 jsPDF——文字可选中可搜索，体积远小于整页光栅化。
 * 内置 Noto Sans SC 预子集字体（GB2312 全 6763 字 + ASCII + 常用符号，2.2MB），
 * 首次导出时下载（HTTP 缓存复用）。内容出现字集外的生僻字时抛
 * MissingGlyphError，由调用方回退 canvas 光栅化方案（exportPdfNative）。
 */
import { jsPDF } from 'jspdf';
import { saveOrShareBlob } from './share';

const FONT_URL = `${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.ttf`;
const FONT_NAME = 'WereadSans';

/** 内容含字体字集之外的字符 */
export class MissingGlyphError extends Error {
  constructor(missing: string) {
    super(`字体缺少生僻字：${missing}`);
    this.name = 'MissingGlyphError';
  }
}

let fontBufferCache: ArrayBuffer | null = null;
let fontCharsCache: Set<number> | null = null;

/** 解析 TTF 的 cmap（format 4 / 12），取字体覆盖的全部码位（导出供测试）。
 * TTF 数值一律大端（DataView 默认）。流程：sfnt 表目录(16B/项)定位 cmap 表 →
 * cmap 子表记录(8B/项)选最优 format（12 > 4）→ 展开码位。 */
export function parseCmapChars(buffer: ArrayBuffer): Set<number> {
  const view = new DataView(buffer);
  const chars = new Set<number>();

  // 1. 表目录找 cmap：记录布局 tag(4) checksum(4) offset(4) length(4)
  const numTables = view.getUint16(4);
  let cmapOff = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 12 > buffer.byteLength) break;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    if (tag === 'cmap') {
      cmapOff = view.getUint32(rec + 8);
      break;
    }
  }
  if (!cmapOff) return chars;

  // 2. 选子表：format 12 覆盖全 Unicode，优先于 format 4（仅 BMP）
  const subCount = view.getUint16(cmapOff + 2);
  let best: { offset: number; format: number } | null = null;
  for (let i = 0; i < subCount; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = view.getUint16(rec);
    const offset = cmapOff + view.getUint32(rec + 4);
    if (offset + 2 > buffer.byteLength) continue;
    const format = view.getUint16(offset);
    const rank = format === 12 ? 2 : format === 4 ? (platform === 3 || platform === 0 ? 1 : 0) : 0;
    if (rank > 0 && (!best || rank > (best.format === 12 ? 2 : 1))) {
      best = { offset, format };
    }
  }
  if (!best) return chars;
  const { offset, format } = best;

  if (format === 12) {
    const nGroups = view.getUint32(offset + 12);
    for (let g = 0; g < nGroups; g++) {
      const rec = offset + 16 + g * 12;
      const start = view.getUint32(rec);
      const end = view.getUint32(rec + 4);
      for (let cp = start; cp <= end && cp <= 0x10FFFF; cp++) chars.add(cp);
    }
  } else if (format === 4) {
    const segCountX2 = view.getUint16(offset + 6);
    const segCount = segCountX2 / 2;
    const endBase = offset + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;
    for (let s = 0; s < segCount; s++) {
      const end = view.getUint16(endBase + s * 2);
      const start = view.getUint16(startBase + s * 2);
      const delta = view.getInt16(deltaBase + s * 2);
      const rangeOffset = view.getUint16(rangeBase + s * 2);
      if (start === 0xFFFF) continue;
      for (let cp = start; cp <= end; cp++) {
        let gid: number;
        if (rangeOffset === 0) {
          gid = (cp + delta) & 0xFFFF;
        } else {
          const glyphPos = rangeBase + s * 2 + rangeOffset + (cp - start) * 2;
          gid = view.getUint16(glyphPos);
          if (gid !== 0) gid = (gid + delta) & 0xFFFF;
        }
        if (gid !== 0) chars.add(cp);
      }
    }
  }
  return chars;
}

async function loadFont(): Promise<{ buffer: ArrayBuffer; chars: Set<number> }> {
  if (!fontBufferCache || !fontCharsCache) {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`字体下载失败（${res.status}）`);
    fontBufferCache = await res.arrayBuffer();
    fontCharsCache = parseCmapChars(fontBufferCache);
    if (fontCharsCache.size < 100) throw new Error('字体解析失败');
  }
  return { buffer: fontBufferCache, chars: fontCharsCache };
}

/** 排版字符集 = 内容 + 固定标签文案；含缺失字形时抛 MissingGlyphError */
function assertCoverage(chars: Set<number>, texts: string[]): void {
  const labels = '微痕笔记成书第页·《》，。！？：；（）—…0123456789 ';
  const all = texts.join('') + labels;
  const missing = new Set<string>();
  for (const ch of all) {
    const cp = ch.codePointAt(0)!;
    if (!chars.has(cp) && !missing.has(ch)) {
      missing.add(ch);
      if (missing.size >= 10) break;
    }
  }
  if (missing.size > 0) throw new MissingGlyphError([...missing].join(' '));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

interface PdfItem {
  kind: 'highlight' | 'thought' | 'review';
  label: string;
  chapter?: string;
  text: string;
  meta?: string;
  stars?: string;
}

interface PdfSection {
  title: string;
  items: PdfItem[];
}

export interface ParsedBook {
  title: string;
  author: string;
  stats: string;
  sections: PdfSection[];
  footer: string;
}

/** 解析成书 HTML → 结构化内容（选择器与 NotesView 导出模板一一对应） */
export function parseBookHtml(html: string): ParsedBook {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('.book-header h2')?.textContent?.trim() || '';
  const author = doc.querySelector('.book-header .author')?.textContent?.trim() || '';
  const stats = doc.querySelector('.book-header .stats')?.textContent?.trim() || '';

  const sections: PdfSection[] = [];
  let current: PdfSection | null = null;
  for (const el of [...doc.body.children]) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.classList.contains('section-title')) {
      current = { title: el.textContent?.trim() || '', items: [] };
      sections.push(current);
    } else if (el.classList.contains('item') && current) {
      const textEl = el.querySelector('.highlight-text, .thought-text, .review-text');
      const kind = textEl?.classList.contains('highlight-text') ? 'highlight'
        : textEl?.classList.contains('review-text') ? 'review' : 'thought';
      current.items.push({
        kind,
        label: el.querySelector('.label')?.textContent?.trim() || '',
        chapter: el.querySelector('.chapter')?.textContent?.trim(),
        text: (textEl?.textContent || '').trim(),
        stars: el.querySelector('.stars')?.textContent?.trim(),
        meta: [...el.querySelectorAll('.meta')]
          .map(m => m.textContent?.trim() || '')
          .filter(Boolean)
          .join(' · '),
      });
    }
  }
  return { title, author, stats, sections, footer: '由 微痕 导出 · 笔记成书' };
}

/** 结构化内容 → 文本层 PDF（Blob） */
export async function bookModelToPdfBlob(parsed: ParsedBook): Promise<Blob> {
  const { buffer, chars } = await loadFont();
  assertCoverage(chars, [
    parsed.title, parsed.author, parsed.stats,
    ...parsed.sections.flatMap(s => [s.title, ...s.items.map(i => `${i.label}\n${i.chapter || ''}\n${i.text}\n${i.meta || ''}\n${i.stars || ''}`)]),
  ]);

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  pdf.addFileToVFS(`${FONT_NAME}.ttf`, toBase64(new Uint8Array(buffer)));
  pdf.addFont(`${FONT_NAME}.ttf`, FONT_NAME, 'normal');

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const M = 56; // 页边距
  const contentW = pageW - M * 2;
  let y = M;

  const ensureSpace = (h: number) => {
    if (y + h <= pageH - M - 20) return;
    pdf.addPage();
    y = M;
  };

  // 书籍信息头
  pdf.setFont(FONT_NAME, 'normal');
  if (parsed.title) {
    pdf.setFontSize(17);
    pdf.setTextColor(30, 30, 30);
    ensureSpace(28);
    pdf.text(parsed.title, pageW / 2, y + 14, { align: 'center', maxWidth: contentW });
    y += 30;
  }
  if (parsed.author) {
    pdf.setFontSize(10.5);
    pdf.setTextColor(110, 110, 110);
    ensureSpace(16);
    pdf.text(parsed.author, pageW / 2, y + 8, { align: 'center', maxWidth: contentW });
    y += 18;
  }
  if (parsed.stats) {
    pdf.setFontSize(9);
    pdf.setTextColor(140, 140, 140);
    ensureSpace(14);
    pdf.text(parsed.stats, pageW / 2, y + 7, { align: 'center', maxWidth: contentW });
    y += 16;
  }
  y += 6;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(M, y, pageW - M, y);
  y += 18;

  for (const section of parsed.sections) {
    pdf.setFontSize(13);
    pdf.setTextColor(40, 40, 40);
    ensureSpace(26);
    pdf.text(section.title, M, y + 11);
    y += 26;

    for (const item of section.items) {
      const labelLine = [item.label, item.chapter].filter(Boolean).join(' · ');
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      const textLines = pdf.splitTextToSize(item.text, contentW) as string[];
      const itemH = 12 + (labelLine ? 12 : 0) + (item.stars ? 12 : 0)
        + textLines.length * 16 + (item.meta ? 12 : 0) + 14;
      ensureSpace(Math.min(itemH, pageH - M * 2 - 20));

      if (labelLine) {
        pdf.text(labelLine, M, y + 6);
        y += 14;
      }
      if (item.stars) {
        pdf.setTextColor(230, 170, 40);
        pdf.setFontSize(10);
        pdf.text(item.stars, M, y + 7);
        y += 14;
      }
      // 划线/书评近黑，想法偏紫灰
      const bodyColor = item.kind === 'thought' ? [85, 85, 95] : [45, 45, 45];
      pdf.setFontSize(10.5);
      pdf.setTextColor(bodyColor[0], bodyColor[1], bodyColor[2]);
      for (const line of textLines) {
        ensureSpace(16);
        pdf.text(line, M, y + 8);
        y += 16;
      }
      if (item.meta) {
        pdf.setFontSize(8);
        pdf.setTextColor(160, 160, 160);
        ensureSpace(12);
        pdf.text(item.meta, M, y + 6);
        y += 12;
      }
      // 条目间隔线
      y += 8;
      pdf.setDrawColor(238, 238, 238);
      pdf.line(M, y, pageW - M, y);
      y += 10;
    }
  }

  // 页脚（含页码）
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setFont(FONT_NAME, 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(parsed.footer, M, pageH - 28);
    pdf.text(`第 ${p} / ${total} 页`, pageW - M, pageH - 28, { align: 'right' });
  }
  return pdf.output('blob');
}

/** 入口：HTML → 文本层 PDF 并分享/下载 */
export async function htmlToTextPdfAndShare(html: string, pdfFileName: string): Promise<void> {
  const parsed = parseBookHtml(html);
  const blob = await bookModelToPdfBlob(parsed);
  await saveOrShareBlob(blob, pdfFileName);
}

/**
 * 原生端成书导出统一入口：优先文本层 PDF（可检索、体积小），
 * 字体缺字或生成失败时回退 canvas 光栅化（exportPdfNative，永不缺字）。
 */
export async function nativeBookPdfWithFallback(html: string, pdfFileName: string): Promise<'text' | 'raster'> {
  try {
    await htmlToTextPdfAndShare(html, pdfFileName);
    return 'text';
  } catch (err) {
    console.warn('[exportPdfText] 文本层 PDF 失败，回退光栅化：', err);
    const { htmlToPdfAndShare } = await import('./exportPdfNative');
    await htmlToPdfAndShare(html, pdfFileName);
    return 'raster';
  }
}
