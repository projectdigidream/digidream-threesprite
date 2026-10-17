import { useEffect } from 'react'
import { autosaveNow } from '../core/io/projectActions'
import { isVscode } from '../core/platform'
import { autosaveStore, needsSave, useAutosaveState } from '../store/autosave'
import { editorStore, useEditor } from '../store/editorStore'

export interface AutosaveTiming {
  /** Save this long after the edits stop. */
  quietMs: number
  /** While they do not stop, save at least this often. */
  maxWaitMs: number
}

export const AUTOSAVE_TIMING: AutosaveTiming = { quietMs: 1000, maxWaitMs: 10000 }

/**
 * Call `save` once the edits pause, and no later than `maxWaitMs` after the
 * first change it has not saved yet, so a long run of strokes is never all at
 * risk. Returns a teardown.
 */
export function scheduleAutosave(save: () => void, timing: AutosaveTiming = AUTOSAVE_TIMING): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let since = 0
  let lastRevision = editorStore.getState().revision
  const fire = () => { timer = undefined; since = 0; save() }
  const unsub = editorStore.subscribe(s => {
    if (s.revision === lastRevision) return
    lastRevision = s.revision
    if (!s.dirty) return
    const now = Date.now()
    if (!since) since = now
    clearTimeout(timer)
    timer = setTimeout(fire, Math.max(0, Math.min(timing.quietMs, since + timing.maxWaitMs - now)))
  })
  return () => { unsub(); clearTimeout(timer) }
}

type Notify = (message: string, kind?: 'info' | 'error') => void

/**
 * Autosave after edits (see `autosaveNow` for where it writes), plus an
 * immediate flush when the page is hidden (Android backgrounding, tab switch,
 * window close). A failure is reported once, until a save succeeds again.
 *
 * Off inside VS Code: the document belongs to the editor tab there, and VS
 * Code keeps its own hot-exit backup of unsaved changes.
 */
export function useAutosave(notify?: Notify): void {
  useEffect(() => {
    if (isVscode()) return
    const save = () => {
      const failing = autosaveStore.getState().failed !== null
      autosaveNow().catch(e => { if (!failing) notify?.(`Autosave failed: ${e instanceof Error ? e.message : String(e)}`, 'error') })
    }
    const stop = scheduleAutosave(save)
    const flush = () => { if (document.visibilityState === 'hidden') save() }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!editorStore.getState().dirty) return
      save()
      // A write started now may not finish before the page goes.
      e.preventDefault()
    }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [notify])
}

/** Whether the • after the project's name shows: changes left to Save, or that autosave could not write. */
export function useNeedsSave(): boolean {
  const toFile = useAutosaveState(a => a.toFile)
  const failed = useAutosaveState(a => a.failed)
  return useEditor(s => needsSave(s, { ...autosaveStore.getState(), toFile, failed }))
}
