import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { injectCspMeta } from './src/main/security/csp'

/**
 * renderer HTML에 CSP meta를 주입한다. 정책은 main과 같은 `buildCspHeader`에서
 * 나오므로 dev(헤더)와 prod(meta)가 서로 다른 정책으로 갈라질 수 없다.
 */
export function cspMetaPlugin(): Plugin {
  return {
    name: 'datacon:csp-meta',
    transformIndexHtml: {
      // post여야 한다 — react-refresh 프리앰블처럼 다른 플러그인이 head 앞쪽에
      // 꽂는 태그가 다 들어온 뒤에 돌아야 meta를 그것들보다 앞에 놓을 수 있다.
      order: 'post',
      // ctx.server는 dev 서버에서만 채워진다. 정책의 dev/prod 분기를 여기서 받는다.
      handler: (html, ctx) => injectCspMeta(html, ctx.server !== undefined),
    },
  }
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), cspMetaPlugin()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
      '@renderer': fileURLToPath(new URL('./src/renderer', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          if (/\/node_modules\/(react|react-dom|scheduler|styled-components)\//.test(id)) return 'ui-vendor'
          if (id.includes('/@codemirror/') || id.includes('/@lezer/')) return 'sql-editor'
          return undefined
        },
      },
    },
  },
})
