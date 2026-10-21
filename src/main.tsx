import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// PWA 更新（手写而非 virtual:pwa-register：该虚拟模块在 tauri/native/harmony
// 模式下不存在，静态导入会让原生端构建失败）。
// autoUpdate 行为：新 SW 安装激活接管控制权时自动刷新页面——否则部署后
// 旧 bundle 会一直挂在已打开的页面上（表现为界面不变）。
// 原生端没有 sw.js，register 404 落入 catch，不影响应用。
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // 无 sw.js（原生 WebView）或注册失败：忽略
    });
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
