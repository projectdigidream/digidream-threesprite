/**
 * Autosave's one preference and its last failure.
 *
 * A project kept in the app library saves itself: every project in the
 * browser and on Android, and on desktop until it is saved to a file. A
 * project linked to a file on disk writes that file only on Save, unless
 * `toFile` is on; meanwhile autosave keeps a recovery copy in the library,
 * which reopening the project offers back.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { EditorState } from './editorStore'

const TO_FILE_KEY = 'threesprite.autosaveToFile'

function readToFile(): boolean {
  try { return localStorage.getItem(TO_FILE_KEY) === '1' } catch { return false }
}

export interface AutosaveState {
  /** Autosave writes a linked file too, not only a recovery copy beside it. */
  toFile: boolean
  /** The last autosave that failed, and the project it failed for; null once one succeeds. */
  failed: { id: string; message: string } | null
  setToFile: (on: boolean) => void
}

export const autosaveStore = createStore<AutosaveState>()(set => ({
  toFile: readToFile(),
  failed: null,
  setToFile(on) {
    try { localStorage.setItem(TO_FILE_KEY, on ? '1' : '0') } catch { /* kept for this session */ }
    set({ toFile: on })
  },
}))

type DocState = Pick<EditorState, 'dirty' | 'source' | 'doc'>

/** Autosave writes the document where it lives, so there is nothing to Save by hand. */
export function savesItself(s: Pick<EditorState, 'source'>, a: AutosaveState = autosaveStore.getState()): boolean {
  if (s.source.host) return false
  return !s.source.path || a.toFile
}

/** Changes the user still has to save, or that autosave could not: what the • after the name marks. */
export function needsSave(s: DocState, a: AutosaveState = autosaveStore.getState()): boolean {
  return s.dirty && (!savesItself(s, a) || a.failed?.id === s.doc.id)
}

export function useAutosaveState<T>(selector: (a: AutosaveState) => T): T {
  return useStore(autosaveStore, selector)
}
