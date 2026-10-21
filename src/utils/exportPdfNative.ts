/**
 * 原生端（鸿蒙/Android/iOS）HTML → 真正的 PDF 文件：
 * jsPDF.html 走 canvas 光栅化（文字以图像形式进入 PDF，无需嵌入中文字体包），
 * 复用现有成书/书评 HTML 模板的完整样式。产物经统一分享出口（鸿蒙分块桥 / Capacitor）。
 */
import { jsPDF } from 'jspdf';
import { saveOrShareDataUrl } from './share';

export async function htmlToPdfAndShare(html: string, pdfFileName: string): Promise<void> {
  // 提取模板的 <style> 与 <body>（innerHTML 注入容器会丢失 head）
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styleText = Array.from(doc.querySelectorAll('style'))
    .map(s => s.textContent || '').join('\n');
  const bodyHtml = doc.body.innerHTML;

  const container = document.createElement('div');
  // A4 宽 210mm ≈ 794px @96dpi；离屏渲染
  container.style.cssText =
    'position:fixed;left:-9999px;top:0;width:794px;background:#ffffff;font-size:14px;';
  container.innerHTML = `<style>${styleText}</style><div style="padding:24px 32px;">${bodyHtml}</div>`;
  document.body.appendChild(container);

  try {
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    await pdf.html(container, {
      html2canvas: {
        scale: 2,
        useCORS: false,
        backgroundColor: '#ffffff',
        windowWidth: 794,
      },
      autoPaging: 'text',
      margin: 18,
    });
    const blob = pdf.output('blob');
    const dataUrl = await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    await saveOrShareDataUrl(dataUrl, pdfFileName);
  } finally {
    container.remove();
  }
}
