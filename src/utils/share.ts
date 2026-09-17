/**
 * 统一的文件保存/分享出口：
 * - Web/桌面：触发浏览器下载
 * - 移动 App（Capacitor）：写入应用缓存目录后调起系统分享面板
 */
import { runtimeEnv } from '../services/dbInterface';

/** 鸿蒙 ArkWeb 壳注入的原生分享桥 */
interface HarmonyShareBridge {
  shareFile(base64: string, fileName: string, mime: string): Promise<boolean>;
}

async function shareOnNative(base64: string, fileName: string, mime = 'application/octet-stream'): Promise<void> {
  if (runtimeEnv === 'harmony') {
    const bridge = (window as unknown as { HarmonyBridge?: HarmonyShareBridge }).HarmonyBridge;
    if (!bridge?.shareFile) {
      throw new Error('鸿蒙分享桥未注入');
    }
    await bridge.shareFile(base64, fileName, mime);
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
    await shareTextFile(html, fileName);
    return true;
  }
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}
