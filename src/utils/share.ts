/**
 * 统一的文件保存/分享出口：
 * - Web/桌面：触发浏览器下载
 * - 移动 App（Capacitor）：写入应用缓存目录后调起系统分享面板
 */
import { runtimeEnv } from '../services/dbInterface';

/** 鸿蒙 ArkWeb 壳注入的原生分享桥（分块传输版） */
interface HarmonyShareBridge {
  shareBegin(): Promise<boolean>;
  shareAppend(chunk: string): Promise<boolean>;
  shareFinish(fileName: string, mime: string): Promise<boolean>;
}

/** ArkTS 抛出的错误跨桥后是普通对象，归一为带 message 的 Error（否则显示 [object Object]） */
function toBridgeError(e: unknown, label: string): Error {
  if (e && typeof e === 'object') {
    const obj = e as { message?: unknown };
    if (typeof obj.message === 'string' && obj.message) return new Error(`${label}: ${obj.message}`);
    try { return new Error(`${label}: ${JSON.stringify(e)}`); } catch { /* ignore */ }
  }
  return new Error(`${label}: ${String(e)}`);
}

async function shareOnNative(base64: string, fileName: string, mime = 'application/octet-stream'): Promise<void> {
  if (runtimeEnv === 'harmony') {
    const bridge = (window as unknown as { HarmonyBridge?: HarmonyShareBridge }).HarmonyBridge;
    if (!bridge?.shareFinish) {
      throw new Error('鸿蒙分享桥未注入');
    }
    // 分块传输：单参数超限会导致桥调用整体失败（rejection 为对象）
    const CHUNK = 256 * 1024;
    try {
      await bridge.shareBegin();
      for (let i = 0; i < base64.length; i += CHUNK) {
        await bridge.shareAppend(base64.slice(i, i + CHUNK));
      }
      await bridge.shareFinish(fileName, mime);
    } catch (e) {
      throw toBridgeError(e, '分享失败');
    }
    return;
  }
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const result = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({
    title: fileName,
    url: result.uri,
  });
}

/** dataURL（含前缀）在移动端分享、Web 端下载 */
export async function saveOrShareDataUrl(dataUrl: string, fileName: string): Promise<void> {
  if (runtimeEnv !== 'web') {
    // 原生端的 base64 参数不接受 data: 前缀；mime 从 dataUrl 解析
    const base64 = dataUrl.split(',')[1] || '';
    const mime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png';
    await shareOnNative(base64, fileName, mime);
    return;
  }
  const link = document.createElement('a');
  link.download = fileName;
  link.href = dataUrl;
  link.click();
}

/** 文本内容（如导出 PDF 的 HTML）在移动端存为文件分享 */
export async function shareTextFile(content: string, fileName: string): Promise<void> {
  if (runtimeEnv !== 'web') {
    const base64 = btoa(unescape(encodeURIComponent(content)));
    await shareOnNative(base64, fileName, 'text/html');
  }
}

/**
 * 打印文档的跨端出口：
 * - Web/桌面：新窗口打开并调起打印（原行为）
 * - 移动 App：WebView 无 window.print，把 HTML 存为文件走系统分享
 *   （用户可保存/转发，或用支持打印的 App 打开）
 */
export async function printOrShareHtml(html: string, fileName: string): Promise<boolean> {
  if (runtimeEnv !== 'web') {
    // 原生端生成真正的 PDF 文件（canvas 光栅化，无需中文字体包）后分享
    const { htmlToPdfAndShare } = await import('./exportPdfNative');
    const pdfName = fileName.replace(/\.html?$/, '') + '.pdf';
    await htmlToPdfAndShare(html, pdfName);
    return true;
  }
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
