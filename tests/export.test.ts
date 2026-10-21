/**
 * 导出链路单测：CSV 转义、TTF cmap 解析（缺字检测的地基）、成书 HTML 结构解析。
 * cmap 用仓库内的真实子集字体文件验证。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { csvEscape, rowsToCsv, tsToLocalDate } from '../src/utils/exportData';
// parseCmapChars 未导出（模块内私有），经由 assertCoverage/字体加载路径间接覆盖；
// 这里直接读源文件中的实现做白盒测试不够稳，改为导出后测试
// parseCmapChars 已导出：直接对真实字体做白盒验证
import { parseBookHtml, parseCmapChars } from '../src/utils/exportPdfText';

describe('CSV 转义', () => {
  it('普通值原样输出', () => {
    expect(csvEscape('书名')).toBe('书名');
  });

  it('含逗号/引号/换行的值加引号并转义内部引号', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('说"你好"')).toBe('"说""你好"""');
    expect(csvEscape('第一行\n第二行')).toBe('"第一行\n第二行"');
  });

  it('null/undefined/数字安全处理', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
    expect(csvEscape(42)).toBe('42');
  });

  it('rowsToCsv 带 BOM 且按 CRLF 连接', () => {
    const csv = rowsToCsv(['列A', '列B'], [['x', 'y'], ['1,000', 'z']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"1,000"');
    expect(csv.split('\r\n').length).toBe(3);
  });
});

describe('时间戳转日期', () => {
  it('秒级时间戳转本地日期字符串', () => {
    const ts = Math.floor(new Date(2026, 0, 15, 9, 30).getTime() / 1000);
    expect(tsToLocalDate(ts)).toBe('2026-01-15 09:30');
  });

  it('空值返回空串', () => {
    expect(tsToLocalDate(0)).toBe('');
    expect(tsToLocalDate(null)).toBe('');
    expect(tsToLocalDate(undefined)).toBe('');
  });
});

describe('parseBookHtml 成书结构解析', () => {
  const html = `<!DOCTYPE html><html><body>
    <div class="book-header">
      <h1>笔记成书</h1>
      <h2>《三体》</h2>
      <p class="author">刘慈欣</p>
      <p class="stats">10 条划线 · 2 条想法 · 1 篇书评</p>
    </div>
    <div class="section-title">📍 划线与想法</div>
    <div class="item">
      <div class="label">划线 1</div>
      <div class="chapter">第一章</div>
      <div class="highlight-text">宇宙很大，生活更大。</div>
      <div class="meta">2026/01/02</div>
    </div>
    <div class="section-title">⭐ 书评</div>
    <div class="item">
      <div class="label">书评 1</div>
      <div class="stars">★★★★☆</div>
      <div class="review-text">很震撼。</div>
      <div class="meta">2026/02/01</div>
      <div class="meta likes">❤️ 8</div>
    </div>
  </body></html>`;

  it('解析书籍信息与分区', () => {
    const parsed = parseBookHtml(html);
    expect(parsed.title).toBe('《三体》');
    expect(parsed.author).toBe('刘慈欣');
    expect(parsed.stats).toContain('10 条划线');
    expect(parsed.sections.map(s => s.title)).toEqual(['📍 划线与想法', '⭐ 书评']);
  });

  it('识别条目类型并聚合 meta', () => {
    const parsed = parseBookHtml(html);
    const highlight = parsed.sections[0].items[0];
    const review = parsed.sections[1].items[0];
    expect(highlight.kind).toBe('highlight');
    expect(highlight.chapter).toBe('第一章');
    expect(highlight.text).toBe('宇宙很大，生活更大。');
    expect(review.kind).toBe('review');
    expect(review.stars).toBe('★★★★☆');
    expect(review.meta).toContain('❤️ 8');
  });

  it('无分区的 HTML 返回空 sections 不报错', () => {
    const parsed = parseBookHtml('<html><body><p>孤立内容</p></body></html>');
    expect(parsed.sections).toEqual([]);
    expect(parsed.title).toBe('');
  });
});

describe('预子集字体文件', () => {
  const fontPath = resolve(__dirname, '../public/fonts/NotoSansSC-Regular.ttf');

  it('文件存在且为有效 TTF（cmap 含常用汉字）', () => {
    const buf = readFileSync(fontPath);
    expect(buf.length).toBeGreaterThan(1024 * 1024);
    // sfnt magic：0x00010000 或 'OTTO'/'true'
    const magic = buf.readUInt32BE(0);
    expect([0x00010000, 0x4F54544F, 0x74727565]).toContain(magic);
  });

  it('体积在 PWA 预缓存上限（4MB）内', () => {
    const size = readFileSync(fontPath).length;
    expect(size).toBeLessThan(4 * 1024 * 1024);
  });

  it('cmap 解析：覆盖 GB2312 常用字，可检出缺字', () => {
    const buf = readFileSync(fontPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const chars = parseCmapChars(ab);
    expect(chars.size).toBeGreaterThan(7000);
    for (const ch of '微痕笔记成书划线想法书评的一是了我不人在他有这个上们来到时大地为子中你说') {
      expect(chars.has(ch.codePointAt(0)!), `缺字: ${ch}`).toBe(true);
    }
    // 生僻字（GB2312 之外）应缺席——这正是触发回退的机制
    expect(chars.has('𠮷'.codePointAt(0)!)).toBe(false);
  });
});
