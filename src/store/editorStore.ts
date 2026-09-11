/**
 * The single mutation funnel. Structural edits go through `commit()` (immer
 * patches → undo stack); pixel strokes go through `commitPixels()` (buffer
 * swap, never immer over typed arrays). `ui` changes are never undoable.
 */
import { applyPatches, enablePatches, produce, produceWithPatches, setAutoFreeze, type Patch } from 'immer'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Rect } from '../domain/image'
import { createProject } from '../domain/project'
import type { Id, PartImage, Project, RGBA, Vec2, ViewIndex } from '../domain/types'

enablePatches()
// Typed arrays cannot be frozen and we swap them by reference; freezing would
// also cost a deep walk over every commit.
setAutoFreeze(false)

export type Mode = 'draw' | 'rig' | 'animate' | 'preview' | 'export'
export type ToolId = 'pencil' | 'eraser' | 'fill' | 'eyedropper' | 'select' | 'move' | 'hand'
export type RigTool = 'select' | 'addBone'

export interface UiState {
  mode: Mode
  tool: ToolId
  rigTool: RigTool
  brushSize: number
  view: ViewIndex
  animId: Id | null
  frame: number
  playing: boolean
  selectedBoneId: Id | null
  selectedPartId: Id | null
  /** Variant of the selected part being edited. */
  variantId: Id | null
  zoom: number
  pan: Vec2
  onion: boolean
  grid: boolean
  mirrorDraw: boolean
  ghostOthers: boolean
  primary: RGBA
  secondary: RGBA
  /** Rect selection in the current image's pixel space. */
  selection: Rect | null
  /** Spread every facing in the 3D preview. */
  spread: boolean
  /** Facing of the single preview instance, turns. */
  previewFacing: number
  /** Facing arrows and labels in the 3D preview. */
  showArrows: boolean
}

export type HistoryEntry =
  | { kind: 'patches'; label: string; patches: Patch[]; inverse: Patch[] }
  | { kind: 'pixels'; label: string; partId: Id; variantId: Id; view: ViewIndex; before: PartImage | undefined; after: PartImage | undefined }

export const HISTORY_CAP = 200

export interface DocSource {
  /** External file path the document is saved to (desktop). Undefined = the app library. */
  path?: string
}

export interface EditorState {
  doc: Project
  /** Bumps on every document change; caches key on it. */
  revision: number
  dirty: boolean
  history: { undo: HistoryEntry[]; redo: HistoryEntry[] }
  ui: UiState
  source: DocSource

  loadProject: (p: Project) => void
  setSource: (s: DocSource) => void
  /** Undoable structural edit. Returns false when the recipe changed nothing. */
  commit: (label: string, recipe: (d: Project) => void) => boolean
  /** Undoable image replacement (buffer swap). `undefined` = image absent. */
  commitPixels: (label: string, partId: Id, variantId: Id, view: ViewIndex, before: PartImage | undefined, after: PartImage | undefined) => void
  undo: () => void
  redo: () => void
  setUi: (patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)) => void
  selectPart: (partId: Id | null) => void
  markSaved: () => void
}

export function defaultUi(doc: Project): UiState {
  const partId = doc.partOrder[0] ?? null
  return reconcileUi(doc, {
    mode: 'draw',
    tool: 'pencil',
    rigTool: 'select',
    brushSize: 1,
    view: 1,
    animId: doc.animationOrder[0] ?? null,
    frame: 0,
    playing: false,
    selectedBoneId: doc.skeleton.rootOrder[0] ?? null,
    selectedPartId: partId,
    variantId: partId ? doc.parts[partId].defaultVariant : null,
    zoom: 8,
    pan: { x: 0, y: 0 },
    onion: false,
    grid: true,
    mirrorDraw: false,
    ghostOthers: true,
    primary: doc.palette.colors[15] ?? [255, 255, 255, 255],
    secondary: doc.palette.colors[0] ?? [0, 0, 0, 255],
    selection: null,
    spread: false,
    previewFacing: 0,
    showArrows: true,
  })
}

/** Make every ui reference point at something that exists in `doc`. */
export function reconcileUi(doc: Project, ui: UiState): UiState {
  const next = { ...ui }
  if (!next.selectedPartId || !doc.parts[next.selectedPartId]) next.selectedPartId = doc.partOrder[0] ?? null
  const part = next.selectedPartId ? doc.parts[next.selectedPartId] : null
  if (!part) next.variantId = null
  else if (!next.variantId || !part.variants[next.variantId]) next.variantId = part.defaultVariant
  if (!next.selectedBoneId || !doc.skeleton.bones[next.selectedBoneId]) next.selectedBoneId = doc.skeleton.rootOrder[0] ?? null
  if (!next.animId || !doc.animations[next.animId]) next.animId = doc.animationOrder[0] ?? null
  const anim = next.animId ? doc.animations[next.animId] : null
  next.frame = anim ? Math.min(Math.max(0, Math.floor(next.frame)), anim.frameCount - 1) : 0
  next.view = Math.min(Math.max(1, Math.floor(next.view)), doc.views.count)
  return next
}

function setImage(d: Project, partId: Id, variantId: Id, view: ViewIndex, image: PartImage | undefined): void {
  const v = d.parts[partId]?.variants[variantId]
  if (!v) return
  if (image) v.images[view] = image
  else delete v.images[view]
}

function push(history: EditorState['history'], entry: HistoryEntry): EditorState['history'] {
  const undo = history.undo.length >= HISTORY_CAP ? history.undo.slice(history.undo.length - HISTORY_CAP + 1) : history.undo.slice()
  undo.push(entry)
  return { undo, redo: [] }
}

export const editorStore = createStore<EditorState>()((set, get) => {
  const initial = createProject()
  return {
    doc: initial,
    revision: 1,
    dirty: false,
    history: { undo: [], redo: [] },
    ui: defaultUi(initial),
    source: {},

    loadProject(p) {
      set(s => ({ doc: p, revision: s.revision + 1, dirty: false, history: { undo: [], redo: [] }, ui: defaultUi(p), source: {} }))
    },

    setSource(source) {
      set({ source })
    },

    commit(label, recipe) {
      const { doc } = get()
      const [next, patches, inverse] = produceWithPatches(doc, recipe)
      if (patches.length === 0) return false
      next.meta.modifiedAt = new Date().toISOString()
      set(s => ({ doc: next, revision: s.revision + 1, dirty: true, history: push(s.history, { kind: 'patches', label, patches, inverse }), ui: reconcileUi(next, s.ui) }))
      return true
    },

    commitPixels(label, partId, variantId, view, before, after) {
      const { doc } = get()
      if (before === after) return
      const next = produce(doc, d => { setImage(d, partId, variantId, view, after) })
      next.meta.modifiedAt = new Date().toISOString()
      set(s => ({ doc: next, revision: s.revision + 1, dirty: true, history: push(s.history, { kind: 'pixels', label, partId, variantId, view, before, after }) }))
    },

    undo() {
      const { history, doc } = get()
      const entry = history.undo[history.undo.length - 1]
      if (!entry) return
      const next = entry.kind === 'patches' ? applyPatches(doc, entry.inverse) : produce(doc, d => { setImage(d, entry.partId, entry.variantId, entry.view, entry.before) })
      set(s => ({ doc: next, revision: s.revision + 1, dirty: true, history: { undo: s.history.undo.slice(0, -1), redo: [...s.history.redo, entry] }, ui: reconcileUi(next, s.ui) }))
    },

    redo() {
      const { history, doc } = get()
      const entry = history.redo[history.redo.length - 1]
      if (!entry) return
      const next = entry.kind === 'patches' ? applyPatches(doc, entry.patches) : produce(doc, d => { setImage(d, entry.partId, entry.variantId, entry.view, entry.after) })
      set(s => ({ doc: next, revision: s.revision + 1, dirty: true, history: { undo: [...s.history.undo, entry], redo: s.history.redo.slice(0, -1) }, ui: reconcileUi(next, s.ui) }))
    },

    setUi(patch) {
      set(s => {
        const p = typeof patch === 'function' ? patch(s.ui) : patch
        return { ui: reconcileUi(s.doc, { ...s.ui, ...p }) }
      })
    },

    selectPart(partId) {
      set(s => {
        const part = partId ? s.doc.parts[partId] : null
        return { ui: reconcileUi(s.doc, { ...s.ui, selectedPartId: part ? partId : null, variantId: part ? part.defaultVariant : null, selection: null, selectedBoneId: part ? part.boneId : s.ui.selectedBoneId }) }
      })
    },

    markSaved() {
      set({ dirty: false })
    },
  }
})

/** React hook over the vanilla store. */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editorStore, selector)
}

export const canUndo = (s: EditorState) => s.history.undo.length > 0
export const canRedo = (s: EditorState) => s.history.redo.length > 0
