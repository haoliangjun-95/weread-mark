import { sanitizeRichText, richTextToPlain } from './sanitize';
import { printOrShareHtml, saveOrShareBlob } from './share';
import { isNativeApp } from '../services/dbInterface';
// 文本层 PDF 模块（含 jsPDF）动态加载：exportPdf 被视图静态引用，
// 静态引入会把 jsPDF 拖回主包（瘦身回归）
import type { ParsedBook } from './exportPdfText';
import { showToast } from './toast';

interface ExportReview {
  bookTitle: string;
  bookAuthor: string;
  bookCover?: string;
  stars: number;
  createTime: string;
  likesCount?: number;
  htmlContent?: string;
  textContent?: string;
}

function sanitizeHtml(html: string): string {
  return sanitizeRichText(html);
}


/** 书名等用户数据要嵌入 <script> 字符串字面量，必须转义引号与反斜杠 */
function escapeJsString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c');
}

/** 单条书评 → 文本层 PDF 的结构化模型 */
function reviewToSection(review: ExportReview, withBookTitle: boolean): ParsedBook['sections'][number] {
  const starsText = '★'.repeat(review.stars) + '☆'.repeat(5 - review.stars);
  const text = review.htmlContent
    ? richTextToPlain(review.htmlContent)
    : (review.textContent || '');
  return {
    title: withBookTitle ? `《${review.bookTitle}》` : '⭐ 书评',
    items: [{
      kind: 'review',
      label: starsText,
      text,
      meta: review.createTime + (review.likesCount ? ` · ♥ ${review.likesCount}` : ''),
    }],
  };
}

/**
 * 原生端：结构化数据直接排版文本层 PDF（可检索）；缺生僻字回退 canvas 光栅化。
 * Web 端：HTML 模板 + 打印窗口（矢量原生）。
 */
function openPrintWindow(doc: string, book: ParsedBook, pdfName: string): boolean {
  if (isNativeApp) {
    void (async () => {
      try {
        const { bookModelToPdfBlob } = await import('./exportPdfText');
        const blob = await bookModelToPdfBlob(book);
        await saveOrShareBlob(blob, pdfName);
        showToast('已生成可检索 PDF，请选择保存或分享', 'success');
      } catch (err) {
        const { MissingGlyphError } = await import('./exportPdfText');
        if (err instanceof MissingGlyphError) {
          console.warn('[exportPdf] 含生僻字，回退光栅化：', err.message);
          const { htmlToPdfAndShare } = await import('./exportPdfNative');
          await htmlToPdfAndShare(doc, pdfName);
          return;
        }
        console.error('[exportPdf] 书评 PDF 失败：', err);
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`导出失败：${msg || '请重试'}`, 'error');
      }
    })();
    return true;
  }
  // 移动端无 window.print 已由原生分支处理；此处为 Web 打印窗口
  void printOrShareHtml(doc, '微痕-书评.html').then(ok => {
    if (!ok) {
      showToast('弹窗被浏览器拦截，请允许弹窗后重试', 'error');
    }
  });
  return true;
}

function resolveCoverUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return 'https://weread-1258476243.file.myqcloud.com' + url;
}
/** 返回 false 表示弹窗被浏览器拦截 */
export function exportReviewToPdf(review: ExportReview): boolean {
  const starsHtml = '★'.repeat(review.stars) + '☆'.repeat(5 - review.stars);
  const contentHtml = review.htmlContent
    ? sanitizeHtml(review.htmlContent)
    : `<p style="white-space:pre-wrap">${review.textContent || ''}</p>`;

  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${review.bookTitle}-书评</title>
<style>
  @page { margin: 2cm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
    font-size: 14px;
    line-height: 1.8;
    color: #222;
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
  }
  .header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 2px solid #e0e0e0;
  }
  .cover {
    flex-shrink: 0;
    width: 80px;
    height: 110px;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .header .info { flex: 1; }
  .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .header .author { font-size: 13px; color: #666; }
  .header .stars { margin-top: 6px; font-size: 16px; color: #e8b61f; }
  .header .meta { margin-top: 8px; font-size: 12px; color: #999; }
  .content {
    font-size: 14px;
    line-height: 1.9;
    color: #333;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .content p { margin-bottom: 0.8em; }
  .content img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; }
  .content blockquote {
    margin: 12px 0;
    padding: 6px 16px;
    border-left: 3px solid #2367d9;
    color: #555;
    background: #f5f7fb;
    border-radius: 0 4px 4px 0;
  }
  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e0e0e0;
    font-size: 11px;
    color: #999;
    text-align: center;
  }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    ${review.bookCover ? `<div class="cover"><img src="${resolveCoverUrl(review.bookCover)}" /></div>` : ''}
    <div class="info">
      <h1>${review.bookTitle}</h1>
      <p class="author">${review.bookAuthor}</p>
      <div class="stars">${starsHtml}</div>
      <div class="meta">
        <span>${review.createTime}</span>
        ${review.likesCount ? `<span style="margin-left:12px">♥ ${review.likesCount}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="content">${contentHtml}</div>
  <div class="footer">由 微痕 导出</div>
  <script>document.title='${escapeJsString(review.bookTitle)}-书评';window.onload=function(){window.print()};</script>
</body>
</html>`;

  return openPrintWindow(doc, {
    title: `《${review.bookTitle}》`,
    author: review.bookAuthor,
    stats: review.createTime,
    sections: [reviewToSection(review, false)],
    footer: '由 微痕 导出',
  }, `${review.bookTitle}-书评.pdf`);
}

/** 返回 false 表示弹窗被浏览器拦截 */
export function exportReviewsToPdf(reviews: ExportReview[], title: string): boolean {
  const items = reviews.map(r => {
    const starsHtml = '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars);
    const contentHtml = r.htmlContent
      ? sanitizeHtml(r.htmlContent)
      : `<p style="white-space:pre-wrap">${r.textContent || ''}</p>`;
    return `
    <div class="review-item">
      <div class="header">
        ${r.bookCover ? `<div class="cover"><img src="${resolveCoverUrl(r.bookCover)}" /></div>` : ''}
        <div class="info">
          <h1>${r.bookTitle}</h1>
          <p class="author">${r.bookAuthor}</p>
          <div class="stars">${starsHtml}</div>
          <div class="meta">
            <span>${r.createTime}</span>
            ${r.likesCount ? `<span style="margin-left:12px">♥ ${r.likesCount}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="content">${contentHtml}</div>
    </div>`;
  }).join('<div class="page-break"></div>');

  const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { margin: 2cm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
    font-size: 14px;
    line-height: 1.8;
    color: #222;
    padding: 20px;
    max-width: 800px;
    margin: 0 auto;
  }
  .review-item { margin-bottom: 32px; }
  .page-break { page-break-after: always; }
  .header {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 2px solid #e0e0e0;
  }
  .cover {
    flex-shrink: 0;
    width: 80px;
    height: 110px;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  .cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .header .info { flex: 1; }
  .header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .header .author { font-size: 13px; color: #666; }
  .header .stars { margin-top: 6px; font-size: 16px; color: #e8b61f; }
  .header .meta { margin-top: 8px; font-size: 12px; color: #999; }
  .content {
    font-size: 14px;
    line-height: 1.9;
    color: #333;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .content p { margin-bottom: 0.8em; }
  .content img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; }
  .content blockquote {
    margin: 12px 0;
    padding: 6px 16px;
    border-left: 3px solid #2367d9;
    color: #555;
    background: #f5f7fb;
    border-radius: 0 4px 4px 0;
  }
  .footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e0e0e0;
    font-size: 11px;
    color: #999;
    text-align: center;
  }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  ${items}
  <div class="footer">由 微痕 导出 · 共 ${reviews.length} 条书评</div>
  <script>document.title='${escapeJsString(title)}';window.onload=function(){window.print()};</script>
</body>
</html>`;

  return openPrintWindow(doc, {
    title,
    author: `共 ${reviews.length} 条书评`,
    stats: '',
    sections: reviews.map(r => reviewToSection(r, true)),
    footer: '由 微痕 导出',
  }, `${title}.pdf`);
}
