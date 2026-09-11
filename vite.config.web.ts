import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only build: no Tauri runtime. Exports that need the Rust side are
// hidden by `isTauri()` at runtime; this flag only marks the bundle.
export default defineConfig({
  plugins: [react()],
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
