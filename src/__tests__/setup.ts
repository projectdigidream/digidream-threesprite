import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

// ── Tauri IPC: never available under vitest ─────────────────────────────────
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))

// ── ResizeObserver stub (not implemented by jsdom) ───────────────────────────
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = vi.fn(function () {
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
  }) as unknown as typeof ResizeObserver
}

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear()
})
