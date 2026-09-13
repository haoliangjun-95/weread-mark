/**
 * 运行时环境检测与数据库连接抽象。
 * 三种环境：web（浏览器/PWA）、tauri（桌面）、capacitor（iOS/Android App）。
 * SQLite 插件差异在 localDb 内部按环境惰性加载适配，业务层只依赖本文件的判断。
 */

export type RuntimeEnv = 'web' | 'tauri' | 'capacitor';

/** tauri dev 不走 tauri mode，必须用注入的全局对象判断而非构建期 env */
export const runtimeEnv: RuntimeEnv = (() => {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) return 'tauri';
  // Capacitor 原生 WebView 注入的全局对象
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (typeof window !== 'undefined' && cap?.isNativePlatform?.()) return 'capacitor';
  return 'web';
})();

export const isTauri = runtimeEnv === 'tauri';
export const isCapacitor = runtimeEnv === 'capacitor';
export const isNativeApp = runtimeEnv !== 'web';
