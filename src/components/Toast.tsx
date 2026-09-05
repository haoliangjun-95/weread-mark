import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

const TOAST_EVENT = 'weread-toast';

const styles: Record<ToastType, string> = {
  success: 'border-green-300',
  error: 'border-red-300',
  info: 'border-blue-300',
};

const icons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  info: 'ℹ',
};

export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail;
      setToasts(prev => [...prev, item]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== item.id));
      }, 3500);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100000] flex flex-col items-center gap-2 px-4 w-full max-w-sm pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`w-full px-4 py-2.5 rounded-xl shadow-lg border text-sm flex items-center gap-2 ${styles[toast.type]}`}
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        >
          <span className="flex-shrink-0">{icons[toast.type]}</span>
          <span className="min-w-0 break-words">{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
