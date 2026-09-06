import { useEffect, useRef } from 'react';

/**
 * 弹窗通用行为：Escape 关闭、打开时焦点移入弹窗、关闭后焦点返回触发元素。
 * 返回的 ref 挂到弹窗面板（需 tabIndex={-1}）。
 */
export function useDialogLifecycle(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);

  return panelRef;
}
