import domtoimage from 'dom-to-image-more';
import { saveOrShareDataUrl } from './share';
import { isHarmony } from '../services/dbInterface';

/** 鸿蒙：封面经原生桥取 dataURL（ArkWeb 对 CDN 图片的 CORS 限制绕行） */
async function fetchCoverViaBridge(url: string): Promise<string> {
  try {
    const bridge = (window as unknown as {
      HarmonyBridge?: { fetchImageBase64?: (u: string) => Promise<string> };
    }).HarmonyBridge;
    if (bridge?.fetchImageBase64) {
      return await bridge.fetchImageBase64(url);
    }
  } catch (err) {
    console.warn('[exportImage] 桥取封面失败：', err);
  }
  return '';
}

import type { ExportStyleType } from '../App';

interface ThoughtEntry {
  content: string;
  time: string;
  likesCount?: number;
  stars?: number;
}

interface ExportImageData {
  bookTitle: string;
  bookAuthor: string;
  bookCover?: string;
  htmlContent?: string;
  type: 'highlight' | 'thought' | 'review';
  content: string;
  time: string;
  chapterName?: string;
  likesCount?: number;
  stars?: number;
  thoughts?: ThoughtEntry[];
  style?: ExportStyleType;
}

const stylePalettes: Record<ExportStyleType, {
  bg: string;
  cardBg: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  quoteIcon: string;
  divider: string;
}> = {
  classic: {
    bg: '#f2f3f5',
    cardBg: '#ffffff',
    textPrimary: '#242424',
    textSecondary: '#737373',
    textMuted: '#a3a3a3',
    accent: '#4f5965',
    quoteIcon: '#dedede',
    divider: '#e7e7e7',
  },
  dark: {
    bg: '#0d1117',
    cardBg: '#171f2e',
    textPrimary: '#e8edf3',
    textSecondary: '#aab6c5',
    textMuted: '#738296',
    accent: '#70a8ff',
    quoteIcon: '#293447',
    divider: '#2b3749',
  },
  paper: {
    bg: '#efe5d7',
    cardBg: '#faf3e8',
    textPrimary: '#4f3928',
    textSecondary: '#86694e',
    textMuted: '#b09676',
    accent: '#b98547',
    quoteIcon: '#d9c7ae',
    divider: '#e8d9c4',
  },
};

function proxyCoverUrl(url: string): string {
  // Tauri 环境下直接使用原始 URL，无需代理
  if (import.meta.env.VITE_COVER_PROXY === 'false') {
    return url;
  }
  if (url.startsWith('https://cdn.weread.qq.com/')) {
    return '/cover-proxy-cdn/' + url.slice('https://cdn.weread.qq.com/'.length);
  }
  if (url.startsWith('https://weread-1258476243.file.myqcloud.com/')) {
    return '/cover-proxy-qcloud/' + url.slice('https://weread-1258476243.file.myqcloud.com/'.length);
  }
  return url;
}

export async function exportItemToImage(data: ExportImageData) {
  const hasThoughts = data.thoughts && data.thoughts.length > 0;
  const colors = stylePalettes[data.style || 'classic'];

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `position:fixed;left:-9999px;top:0;background:${colors.bg};`;

  // 竖版卡片 9:16 (600x1066)
  const card = document.createElement('div');
  card.style.cssText = `
    width: 600px;
    min-height: 1066px;
    background: ${colors.cardBg};
    padding: 70px 65px;
    font-family: serif;
    color: ${colors.textPrimary};
  `;

  // 解析日期
  const timeParts = data.time.split(/[/\s:-]/);
  const day = timeParts[2]?.split(' ')[0] || timeParts[0];
  const monthMap = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const month = monthMap[parseInt(timeParts[1]) - 1] || '五月';
  const year = timeParts[0] || '2026';

  // ============ 顶部：封面 + 日期区域 ============
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:35px;margin-top:40px;margin-bottom:45px;';

  // 封面
  const coverWrapper = document.createElement('div');
  coverWrapper.style.cssText = 'flex-shrink:0;';

  const coverDiv = document.createElement('div');
  const coverBg = colors.cardBg === '#1a202c' ? '#2d3748' : '#f0ede8';
  const coverFg = colors.cardBg === '#1a202c' ? '#4a5568' : '#d5d0c5';
  coverDiv.style.cssText = `width:110px;height:155px;border-radius:6px;overflow:hidden;background:${coverBg};display:flex;align-items:center;justify-content:center;font-size:44px;color:${coverFg};`;
  if (data.bookCover) {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    let coverSrc = proxyCoverUrl(data.bookCover);
    // 鸿蒙 ArkWeb 下 origin 为 null，CDN 图片的 CORS 校验失败导致封面加载不出：
    // 先经原生桥取回 dataURL（原生 http 无 CORS），同源嵌入对两条渲染链路都安全
    if (isHarmony) {
      const dataUrl = await fetchCoverViaBridge(coverSrc);
      if (dataUrl) coverSrc = dataUrl;
    }
    img.src = coverSrc;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    img.onerror = () => { coverDiv.textContent = '📖'; };
    coverDiv.appendChild(img);
  } else {
    coverDiv.textContent = '📖';
  }
  coverWrapper.appendChild(coverDiv);
  header.appendChild(coverWrapper);

  // 日期区域
  const dateSection = document.createElement('div');
  dateSection.style.cssText = 'flex:1;padding-top:28px;';

  const daySpan = document.createElement('div');
  daySpan.style.cssText = `font-size:40px;font-weight:500;color:${colors.textPrimary};line-height:1.2;font-family:Georgia,Times,serif;`;
  daySpan.textContent = day.padStart(2, '0');
  dateSection.appendChild(daySpan);

  const spacer = document.createElement('div');
  spacer.style.cssText = 'height:8px;';
  dateSection.appendChild(spacer);

  const yearMonthSpan = document.createElement('div');
  yearMonthSpan.style.cssText = `font-size:16px;color:${colors.textSecondary};line-height:1.5;letter-spacing:1px;`;
  yearMonthSpan.textContent = `${year} · ${month}`;
  dateSection.appendChild(yearMonthSpan);

  header.appendChild(dateSection);
  card.appendChild(header);

  // ============ 正文内容 ============
  const contentSection = document.createElement('div');
  contentSection.style.cssText = 'margin-top:30px;';

  // 划线内容 - 使用和想法内容完全一样的结构
  const rawText = data.htmlContent
    ? data.htmlContent
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<p>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
    : data.content;

  const paragraphs = rawText.split('\n').filter(p => p.trim() !== '');
  if (paragraphs.length === 0 && rawText.trim()) {
    paragraphs.push(rawText.trim());
  }

  // 使用和想法内容完全一样的结构
  paragraphs.forEach((para, i) => {
    const item = document.createElement('div');
    item.style.cssText = `margin-bottom:${i < paragraphs.length - 1 ? '18px' : '0'};`;

    const content = document.createElement('div');
    content.style.cssText = `
      font-size:18px;line-height:1.7;color:${colors.textPrimary};
      word-break:break-word;
    `;
    content.textContent = para.trim();
    item.appendChild(content);

    contentSection.appendChild(item);
  });

  // 想法内容（如有）
  if (hasThoughts) {
    const thoughtDivider = document.createElement('div');
    thoughtDivider.style.cssText = `text-align:center;margin:36px 0 28px;color:${colors.divider};font-size:14px;`;
    thoughtDivider.textContent = '· · ·';
    contentSection.appendChild(thoughtDivider);

    data.thoughts!.forEach((t, i) => {
      const thoughtItem = document.createElement('div');
      thoughtItem.style.cssText = `margin-bottom:${i < data.thoughts!.length - 1 ? '18px' : '0'};`;

      const tContent = document.createElement('div');
      tContent.style.cssText = `
        font-size:18px;line-height:1.7;color:${colors.textSecondary};
        font-style:italic;word-break:break-word;white-space:pre-wrap;
      `;
      tContent.textContent = t.content;
      thoughtItem.appendChild(tContent);

      contentSection.appendChild(thoughtItem);
    });
  }

  card.appendChild(contentSection);

  // ============ 底部书籍信息 ============
  const footerSection = document.createElement('div');
  footerSection.style.cssText = 'text-align:center;margin-top:50px;padding-top:50px;';

  const bookTitleEl = document.createElement('div');
  bookTitleEl.style.cssText = `font-size:15px;color:${colors.textSecondary};margin-bottom:6px;`;
  bookTitleEl.textContent = `《${data.bookTitle}》`;
  footerSection.appendChild(bookTitleEl);

  const bookAuthorEl = document.createElement('div');
  bookAuthorEl.style.cssText = `font-size:13px;color:${colors.textMuted};`;
  bookAuthorEl.textContent = data.bookAuthor;
  footerSection.appendChild(bookAuthorEl);

  const brandSection = document.createElement('div');
  brandSection.style.cssText = `text-align:center;margin-top:35px;font-size:12px;color:${colors.textMuted};opacity:0.6;letter-spacing:4px;`;
  brandSection.textContent = '微 痕';
  footerSection.appendChild(brandSection);

  card.appendChild(footerSection);

  wrapper.appendChild(card);
  document.body.appendChild(wrapper);

  // 等待图片加载完成
  const images = card.querySelectorAll('img');
  if (images.length > 0) {
    await Promise.all(Array.from(images).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.onload = resolve;
        img.onerror = resolve;
      });
    }));
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 等待一帧，确保布局完成
  await new Promise(resolve => requestAnimationFrame(resolve));

  try {
    let dataUrl: string;
    try {
      // 先转成 SVG，SVG 渲染更准确（部分 WebView 如鸿蒙 ArkWeb 不支持
      // foreignObject SVG，加载失败时回退 html2canvas 纯 canvas 方案）
      const svgDataUrl = await domtoimage.toSvg(card, {
        bgcolor: colors.cardBg,
      });
    // 从 SVG data URL 创建图片
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      // 裸 reject(Event) 会让上层 catch 显示 [object Event]，改为可读错误
      img.onerror = () => reject(new Error('SVG 图片加载失败（当前 WebView 可能不支持 foreignObject）'));
      img.src = svgDataUrl;
    });
    // 绘制到 canvas
    const canvas = document.createElement('canvas');
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
      dataUrl = canvas.toDataURL('image/png');
    } catch (svgErr) {
      console.warn('[exportImage] SVG 链路失败，回退 html2canvas：', svgErr);
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(card, {
        backgroundColor: colors.cardBg,
        scale: 2,
        useCORS: false,
        allowTaint: false,
      });
      dataUrl = canvas.toDataURL('image/png');
    }
    // Web/桌面走下载；移动 App 调起系统分享面板
    await saveOrShareDataUrl(dataUrl, `${data.bookTitle}-笔记-${Date.now()}.png`);
  } finally {
    document.body.removeChild(wrapper);
  }
}
