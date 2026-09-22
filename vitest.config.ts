import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  esbuild: { tsconfigRaw: { compilerOptions: {} } },
  test: {
    typecheck: { tsconfig: './tsconfig.test.json' },
    // The VS Code extension is a separate package with its own runner
    // (`npm test` in vscode/, on node:test against its compiled output).
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/vite-env.d.ts', 'src/main.tsx', 'src/main.web.tsx'],
    },
  },
})
