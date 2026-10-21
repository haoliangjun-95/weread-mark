import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// autoUpdate 模式：后台安装新 SW，接管控制权时自动刷新页面，
// 否则旧 bundle 会一直挂在已打开的页面上（表现为部署后界面不变）
registerSW()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
