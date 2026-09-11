import { useEffect } from 'react'
import { autosaveNow } from '../core/io/projectActions'
import { editorStore } from '../store/editorStore'

/**
 * Debounced autosave into the library after edits, plus an immediate flush
 * when the page is hidden (Android backgrounding, tab switch, window close).
 */
export function useAutosave(delayMs = 2000): void {
  useEffect(() => {
    let timer = 0
    let lastRevision = editorStore.getState().revision
    const unsub = editorStore.subscribe(s => {
      if (s.revision === lastRevision || !s.dirty) return
      lastRevision = s.revision
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { autosaveNow().catch(() => {}) }, delayMs)
    })
    const flush = () => { if (document.visibilityState === 'hidden') autosaveNow().catch(() => {}) }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (editorStore.getState().dirty) { autosaveNow().catch(() => {}); e.preventDefault() }
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      unsub()
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [delayMs])
}
