import { rename } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only build: no Tauri runtime. Exports that need the Rust side are
// hidden by `isTauri()` at runtime; this flag only marks the bundle.
//
// The output is a plain static site: relative asset URLs (`base: './'`) so it
// works at a domain root or under any sub-path (GitHub Pages, a folder on any
// host), and the entry page is renamed to `index.html`, the default document
// every static host serves.
export default defineConfig({
  base: './',
  plugins: [react(), entryAsIndexHtml()],
  define: {
    'import.meta.env.VITE_WEB_MODE': '"true"',
  },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: 'index.web.html',
    },
  },
  server: {
    port: 1421,
  },
})

function entryAsIndexHtml(): Plugin {
  let outDir = 'dist-web'
  return {
    name: 'threesprite:entry-as-index-html',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    async closeBundle() { await rename(join(outDir, 'index.web.html'), join(outDir, 'index.html')) },
  }
}
