import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf-8')
) as { version: string }

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    ...(mode !== 'tauri' ? [VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: '微痕 — 微信读书数据可视化',
        short_name: '微痕',
        description: '微信读书数据可视化：阅读看板、书架、笔记、书评与全文搜索',
        theme_color: '#2367d9',
        background_color: '#f3f6fb',
        display: 'standalone',
        icons: [
          { src: 'logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // 静态资源预缓存；API 与封面代理不缓存
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/cover-proxy-/],
        globPatterns: ['**/*.{js,css,html,png,svg,jpg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.weread\.qq\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'weread-covers',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    })] : []),
  ],
  build: {
    sourcemap: false,
    minify: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    strictPort: true,
    proxy: {
      '/api': {
        target: 'https://i.weread.qq.com',
        changeOrigin: true,
      },
      '/cover-proxy-cdn': {
        target: 'https://cdn.weread.qq.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cover-proxy-cdn/, ''),
      },
      '/cover-proxy-qcloud': {
        target: 'https://weread-1258476243.file.myqcloud.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cover-proxy-qcloud/, ''),
      },
    },
  },
})
)
