import { useEffect, useState } from 'react';

/**
 * 全局频控状态提示条：监听网络层的 weread-throttled / recovered 事件。
 * 限流时在页面顶部显示状态（替代「无限转圈不知道发生了什么」的体验），
 * 恢复后自动消失。
 */
export default function ThrottleBanner() {
  const [throttled, setThrottled] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);

  useEffect(() => {
    const onThrottled = (e: Event) => {
      const detail = (e as CustomEvent<{ consecutive: number }>).detail;
      setThrottled(true);
      // 达到熔断阈值时网络层会整体冷却 90 秒，据此展示预计恢复时间
      if (detail?.consecutive >= 5) {
        setCooldownUntil(Date.now() + 90_000);
      }
    };
    const onRecovered = () => {
      setThrottled(false);
      setCooldownUntil(null);
    };
    window.addEventListener('weread-throttled', onThrottled);
    window.addEventListener('weread-throttled-recovered', onRecovered);
    return () => {
      window.removeEventListener('weread-throttled', onThrottled);
      window.removeEventListener('weread-throttled-recovered', onRecovered);
    };
  }, []);

  // 冷却剩余秒数按秒更新（渲染期不调用 Date.now 这类不纯函数）
  const [remainSec, setRemainSec] = useState(0);
  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => setRemainSec(Math.max(0, Math.round((cooldownUntil - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  if (!throttled) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-[99998] px-4 py-2 rounded-xl shadow-lg border text-xs flex items-center gap-2"
      style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--warning-text)', borderColor: 'var(--border-color)' }}
    >
      <span className="animate-pulse">⏳</span>
      <span>
        微信读书网关限流中，自动退避重试
        {remainSec > 0 && `（约 ${remainSec}s 后恢复）`}
        ，本地功能不受影响
      </span>
    </div>
  );
}
