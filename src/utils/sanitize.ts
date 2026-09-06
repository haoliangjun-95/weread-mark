import DOMPurify from 'dompurify';

/**
 * 统一富文本净化：所有来自 API 的 HTML（想法/书评 htmlContent）
 * 在渲染（dangerouslySetInnerHTML）或导出（打印文档）前必须经过这里。
 * 去除 script/事件属性/javascript: 协议等可执行内容。
 */
export function sanitizeRichText(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/** 从富文本安全提取纯文本：DOMParser 解析的文档不加载资源，避免 img onerror 等副作用 */
export function richTextToPlain(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(sanitizeRichText(html), 'text/html');
  return doc.body.textContent || '';
}
