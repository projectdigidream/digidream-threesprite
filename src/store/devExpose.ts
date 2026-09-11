import { createProject } from '../domain/project'
import { editorStore } from './editorStore'

/** Dev builds expose the store (and a project factory) for the browser-driven smoke scripts. Stripped from production bundles. */
export function exposeDevStore(): void {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const w = window as unknown as { __editorStore: typeof editorStore; __createProject: typeof createProject }
    w.__editorStore = editorStore
    w.__createProject = createProject
  }
}
