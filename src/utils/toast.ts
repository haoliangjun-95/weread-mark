import type { ToastType } from '../components/Toast';

const TOAST_EVENT = 'weread-toast';
let nextId = 1;

/** 全局轻提示：导出成功/失败、复制成功等场景的统一反馈出口 */
export function showToast(message: string, type: ToastType = 'info') {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
    detail: { id: nextId++, type, message },
  }));
}
