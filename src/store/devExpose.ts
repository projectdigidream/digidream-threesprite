import { editorStore } from './editorStore'

/** Dev builds expose the store for the browser-driven smoke scripts. Stripped from production bundles. */
export function exposeDevStore(): void {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    ;(window as unknown as { __editorStore: typeof editorStore }).__editorStore = editorStore
  }
}
