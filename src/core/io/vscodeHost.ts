/**
 * Bridge to the VS Code extension host.
 *
 * Inside the extension's webview the file belongs to VS Code: it opens the
 * `.tsprite`, drives Save and hot-exit backups, and owns the tab's dirty mark.
 * This module receives the bytes, hands them to the store, reports edits back
 * so VS Code knows the document changed, and re-encodes on demand.
 *
 * The message union is mirrored in `vscode/src/protocol.ts`; change both.
 */
import { editorStore } from '../../store/editorStore'
import { isVscode } from '../platform'
import { decodeProject, encodeProject } from './projectFile'

interface VsCodeApi {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

/** Host → webview. */
type Incoming =
  | { type: 'init'; body: string; path: string }
  | { type: 'revert'; body: string }
  | { type: 'getBytes'; id: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' }

/** Webview → host. */
type Outgoing =
  | { type: 'ready' }
  | { type: 'edit' }
  | { type: 'bytes'; id: number; body: string }
  | { type: 'save' }
  | { type: 'error'; message: string }

let api: VsCodeApi | null | undefined
let started = false

function getApi(): VsCodeApi | null {
  if (api !== undefined) return api
  const acquire = (window as unknown as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi
  // `acquireVsCodeApi` may only be called once per webview, hence the cache.
  api = typeof acquire === 'function' ? acquire() : null
  return api
}

function post(message: Outgoing): void {
  getApi()?.postMessage(message)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

type Notify = (message: string, kind?: 'info' | 'error') => void
/** Called when the host opens an empty file, with a project name taken from the file name. */
type OnEmptyFile = (suggestedName: string) => void

/** `…/hero.tsprite` → `hero`. */
export function projectNameFromPath(path: string | undefined): string {
  const base = (path ?? '').split(/[\\/]/).pop() ?? ''
  return base.replace(/\.tsprite$/i, '').trim() || 'New sprite'
}

/** Set once an empty file opens, until the project the user sets up lands in it. */
let awaitingFirstProject = false

function load(body: string, path: string | undefined, notify: Notify, onEmptyFile: OnEmptyFile | undefined): void {
  const s = editorStore.getState()
  if (!body) {
    // A brand-new file (the New Sprite Project command writes an empty one).
    // Bind the tab first, so the project set up next is loaded into this file.
    s.setSource({ path, host: 'vscode' })
    s.markSaved()
    awaitingFirstProject = true
    onEmptyFile?.(projectNameFromPath(path))
    return
  }
  const { project, warnings } = decodeProject(base64ToBytes(body))
  // Cleared before loading: the store notifies synchronously, and a file that
  // arrives with content is not waiting for a first project.
  awaitingFirstProject = false
  s.loadProject(project)
  s.setSource({ path, host: 'vscode' })
  s.markSaved()
  if (warnings.length) notify(warnings.join('\n'))
}

/**
 * Start listening to the host. Safe to call more than once; does nothing
 * outside VS Code. Returns a teardown for the message listener.
 */
export function startVscodeBridge(notify: Notify, onEmptyFile?: OnEmptyFile): () => void {
  if (!isVscode() || started) return () => {}
  started = true

  const onMessage = (e: MessageEvent<Incoming>) => {
    const msg = e.data
    if (!msg || typeof msg.type !== 'string') return
    try {
      switch (msg.type) {
        case 'init':
          load(msg.body, msg.path, notify, onEmptyFile)
          break
        case 'revert':
          load(msg.body, editorStore.getState().source.path, notify, onEmptyFile)
          break
        case 'getBytes':
          post({ type: 'bytes', id: msg.id, body: bytesToBase64(encodeProject(editorStore.getState().doc)) })
          break
        case 'undo':
          editorStore.getState().undo()
          break
        case 'redo':
          editorStore.getState().redo()
          break
        case 'saved':
          editorStore.getState().markSaved()
          break
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      notify(message, 'error')
      post({ type: 'error', message })
    }
  }
  window.addEventListener('message', onMessage)

  // One `edit` per undoable commit, so the host's undo stack tracks ours.
  // `revision` alone would also fire for live drag previews, which are not edits.
  let depth = editorStore.getState().history.undo.length
  let docId = editorStore.getState().doc.id
  const unsub = editorStore.subscribe(s => {
    const next = s.history.undo.length
    if (next > depth) post({ type: 'edit' })
    depth = next
    // The project set up for an empty file is written straight away, so the
    // file on disk is a real project and not a zero-byte placeholder.
    if (s.doc.id !== docId) {
      docId = s.doc.id
      if (awaitingFirstProject && s.source.host === 'vscode') {
        awaitingFirstProject = false
        post({ type: 'edit' })
        post({ type: 'save' })
      }
    }
  })

  post({ type: 'ready' })
  return () => {
    window.removeEventListener('message', onMessage)
    unsub()
    started = false
    awaitingFirstProject = false
  }
}

/** Ask VS Code to save the document; it will call back for the bytes. */
export function requestHostSave(): void {
  post({ type: 'save' })
}
