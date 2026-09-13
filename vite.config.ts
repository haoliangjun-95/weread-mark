import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf-8')
) as { version: string }

/**
 * HarmonyOS ArkWeb 以 resource://rawfile/ 加载本地页面时 origin 为 null，
 * 外链 <script type="module"> 与 crossorigin 资源会被 CORS 策略拦截导致白屏。
 * 该插件将入口 JS/CSS 内联进 index.html（内联资源不发请求，不受 CORS 限制）。
 * 需配合 rollupOptions.output.inlineDynamicImports 保证入口 JS 为单一文件。
 */
function inlineEntryForRawfile(): Plugin {
  return {
    name: 'inline-entry-for-rawfile',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html']
      if (!html || html.type !== 'asset') return
      let source = String(html.source)
      for (const fileName of Object.keys(bundle)) {
        const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const item = bundle[fileName]!
        if (fileName.endsWith('.js') && item.type === 'chunk' && item.isEntry) {
          // 内联后 import.meta.url 基准从 chunk 目录变为文档根目录，
          // 将 new URL('<file>', import.meta.url) 的相对路径改写为带 chunk 目录前缀
          const dir = fileName.includes('/')
            ? `./${fileName.slice(0, fileName.lastIndexOf('/') + 1)}`
            : './'
          let code = item.code.replace(
            /new URL\((['"`])([^'"`\n]+)\1(\s*),(\s*)import\.meta\.url\)/g,
            (_m, q: string, f: string, s1: string, s2: string) =>
              f.startsWith('.') ? _m : `new URL(${q}${dir}${f}${q}${s1},${s2}import.meta.url)`
          )
          code = code.replace(/<\/script>/g, '<\\/script>')
          source = source.replace(
            new RegExp(`<script type="module"[^>]*src="[^"]*${esc}"[^>]*></script>`),
            () => `<script type="module">\n${code}\n</script>`
          )
        } else if (fileName.endsWith('.css') && item.type === 'asset') {
          const css = String(item.source).replace(/<\/style>/g, '<\\/style>')
          source = source.replace(
            new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${esc}"[^>]*>`),
            () => `<style>\n${css}\n</style>`
          )
        }
      }
      html.source = source
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    ...(mode !== 'tauri' && mode !== 'native' && mode !== 'harmony' ? [VitePWA({
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
    ...(mode === 'harmony' ? [inlineEntryForRawfile()] : []),
  ],
  build: {
    sourcemap: false,
    minify: true,
    ...(mode === 'harmony' ? {
      modulePreload: false,
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    } : {}),
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
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
