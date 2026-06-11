 import html2canvas from 'html2canvas';
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

 function sanitizeHtml(html: string): string {
   return html
     .replace(/<script[\s\S]*?<\/script>/gi, '')
     .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
     .replace(/javascript:/gi, '');
 }

 function proxyCoverUrl(url: string): string {
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
   wrapper.style.cssText = `position:fixed;left:-9999px;top:0;display:flex;align-items:center;justify-content:center;padding:40px;background:${colors.bg};`;
   document.body.appendChild(wrapper);

   // 竖版卡片 9:16 (600x1066)
   const card = document.createElement('div');
   card.style.cssText = `
     width: 600px;
     min-height: 1066px;
     background: ${colors.cardBg};
     padding: 70px 65px;
     font-family: 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', 'SimSun', serif;
     color: ${colors.textPrimary};
     position: relative;
     display: flex;
     flex-direction: column;
   `;

   // 解析日期
   const timeParts = data.time.split(/[/\s:-]/);
   const day = timeParts[2]?.split(' ')[0] || timeParts[0];
   const monthMap = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
   const month = monthMap[parseInt(timeParts[1]) - 1] || '五月';
   const year = timeParts[0] || '2026';

   // ============ 顶部：封面 + 日期区域 ============
   const header = document.createElement('div');
   header.style.cssText = 'display:flex;align-items:center;gap:35px;margin-bottom:45px;';

   // 封面
   const coverWrapper = document.createElement('div');
   coverWrapper.style.cssText = 'flex-shrink:0;';

   const coverDiv = document.createElement('div');
   const coverBg = colors.cardBg === '#1a202c' ? '#2d3748' : '#f0ede8';
   const coverFg = colors.cardBg === '#1a202c' ? '#4a5568' : '#d5d0c5';
   coverDiv.style.cssText = `width:110px;height:155px;border-radius:6px;overflow:hidden;background:${coverBg};display:flex;align-items:center;justify-content:center;font-size:44px;color:${coverFg};box-shadow:0 3px 12px rgba(0,0,0,0.06);`;
   if (data.bookCover) {
     const img = document.createElement('img');
     img.crossOrigin = 'anonymous';
     img.src = proxyCoverUrl(data.bookCover);
     img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
     img.onerror = () => { coverDiv.textContent = '📖'; };
     coverDiv.appendChild(img);
   } else {
     coverDiv.textContent = '📖';
   }
   coverWrapper.appendChild(coverDiv);
   header.appendChild(coverWrapper);

   // 日期区域 - 中文月份，与封面视觉对齐
   const dateSection = document.createElement('div');
   dateSection.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:center;height:155px;';

   const dayEl = document.createElement('div');
   dayEl.style.cssText = `font-size:64px;font-weight:500;color:${colors.textPrimary};line-height:1.1;font-family:Georgia,Times,serif;`;
   dayEl.textContent = day.padStart(2, '0');
   dateSection.appendChild(dayEl);

   const monthYearEl = document.createElement('div');
   monthYearEl.style.cssText = `font-size:16px;color:${colors.textSecondary};margin-top:8px;letter-spacing:1px;`;
   monthYearEl.textContent = `${year} · ${month}`;
   dateSection.appendChild(monthYearEl);

   header.appendChild(dateSection);
   card.appendChild(header);

   // ============ 引引号（弱化） ============
   const quoteIcon = document.createElement('div');
   quoteIcon.style.cssText = `text-align:center;font-size:36px;color:${colors.quoteIcon};margin-bottom:20px;opacity:0.5;`;
   quoteIcon.textContent = '❝';
   card.appendChild(quoteIcon);

   // ============ 正文内容 ============
   const contentSection = document.createElement('div');
   contentSection.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:flex-start;';

   // 主引语 - 划线内容（稍大字号，深灰色）
   const mainContent = document.createElement('div');
   mainContent.style.cssText = `
     font-size:22px;line-height:1.7;color:${colors.textPrimary};
     text-align:justify;word-break:break-word;margin-bottom:0;
   `;
   mainContent.style.cssText += 'white-space:pre-wrap;';
   if (data.htmlContent) mainContent.innerHTML = sanitizeHtml(data.htmlContent);
   else mainContent.textContent = data.content;
   contentSection.appendChild(mainContent);

   // 想法内容（如有）- 浅灰色，字号略小
   if (hasThoughts) {
     // 优雅的分隔线
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
         font-style:italic;word-break:break-word;
       `;
       tContent.textContent = t.content;
       thoughtItem.appendChild(tContent);

       contentSection.appendChild(thoughtItem);
     });
   }

   card.appendChild(contentSection);

   // ============ 底部书籍信息（弱化处理） ============
   const footerSection = document.createElement('div');
   footerSection.style.cssText = 'text-align:center;margin-top:auto;padding-top:50px;';

   const bookTitleEl = document.createElement('div');
   bookTitleEl.style.cssText = `font-size:15px;color:${colors.textSecondary};margin-bottom:6px;`;
   bookTitleEl.textContent = `《${data.bookTitle}》`;
   footerSection.appendChild(bookTitleEl);

   const bookAuthorEl = document.createElement('div');
   bookAuthorEl.style.cssText = `font-size:13px;color:${colors.textMuted};`;
   bookAuthorEl.textContent = data.bookAuthor;
   footerSection.appendChild(bookAuthorEl);

   // 最底部品牌标识（极度弱化）
   const brandSection = document.createElement('div');
   brandSection.style.cssText = `text-align:center;margin-top:35px;font-size:12px;color:${colors.textMuted};opacity:0.6;letter-spacing:4px;`;
   brandSection.textContent = '微 痕';
   footerSection.appendChild(brandSection);

   card.appendChild(footerSection);

   wrapper.appendChild(card);

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
     await new Promise(resolve => setTimeout(resolve, 200));
   }

   try {
     const canvas = await html2canvas(card, {
       scale: 2,
       backgroundColor: colors.cardBg,
       allowTaint: true,
       useCORS: true,
       logging: false,
     });
     const link = document.createElement('a');
     link.download = `${data.bookTitle}-笔记-${Date.now()}.png`;
     link.href = canvas.toDataURL('image/png');
     link.click();
   } finally {
     document.body.removeChild(wrapper);
   }
 }