import { createProject } from '../domain/project'
import { editorStore } from './editorStore'

/**
 * Exposes the store (and a project factory) for the browser-driven smoke
 * scripts. Dev builds always do; a production build does it only when the page
 * set `window.__THREESPRITE_TEST__` before the bundle ran, which is how the
 * scripts drive the real built output — the VS Code webview among them.
 * Nothing here reads or writes anything a user of the page could not already
 * reach through the UI.
 */
export function exposeDevStore(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as {
    __editorStore?: typeof editorStore
    __createProject?: typeof createProject
    __THREESPRITE_TEST__?: boolean
  }
  if (!import.meta.env.DEV && !w.__THREESPRITE_TEST__) return
  w.__editorStore = editorStore
  w.__createProject = createProject
}
