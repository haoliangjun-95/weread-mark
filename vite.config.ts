import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const pkg = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf-8')
) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: false,
    minify: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
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
