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
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}


function resolveCoverUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return 'https://weread-1258476243.file.myqcloud.com' + url;
}
export function exportReviewToPdf(review: ExportReview) {
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
  <script>document.title='${review.bookTitle}-书评';window.onload=function(){window.print()};</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(doc);
    win.document.close();
  }
}

export function exportReviewsToPdf(reviews: ExportReview[], title: string) {
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
  <script>document.title='${title}';window.onload=function(){window.print()};</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(doc);
    win.document.close();
  }
}
