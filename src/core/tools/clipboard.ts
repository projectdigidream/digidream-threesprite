/**
 * Copy, cut and paste of pixels: the selection, or the whole image when
 * nothing is selected. The clipboard is ThreeSprite's own, so a piece carries
 * across views, parts, variants and projects. A paste floats over what was
 * under it until something else touches that image, so Move can drag it into
 * place without eating the art beneath.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { blitCopy, clearRect, cloneImage, createImage, cropImage, type Rect } from '../../domain/image'
import { getPartImage, newImageSize } from '../../domain/project'
import type { Id, PartImage } from '../../domain/types'
import { isDerived, mirrorOf } from '../../domain/views'
import { editorStore, shownVariant, type EditorState } from '../../store/editorStore'

export interface Clip { image: PartImage; x: number; y: number }

interface ClipState {
  clip: Clip | null
  /** A line for the canvas to show; a new object each time, so a repeat shows again. */
  note: { text: string } | null
}

export const clipStore = createStore<ClipState>(() => ({ clip: null, note: null }))
export const useClip = <T,>(sel: (s: ClipState) => T): T => useStore(clipStore, sel)

const say = (text: string): false => { clipStore.setState({ note: { text } }); return false }

/** Where the clipboard works: the image the canvas paints, for the selected part in the active view. */
interface Spot { partId: Id; variantId: Id; view: number; image: PartImage | undefined }

function spot(s: EditorState): Spot | string {
  const part = s.ui.selectedPartId ? s.doc.parts[s.ui.selectedPartId] : null
  if (!part) return 'Select a part first'
  if (part.solids) return `${part.name} is built from 3D shapes, not pixels`
  const { count, mirror } = s.doc.views
  if (isDerived(count, mirror, s.ui.view)) return `View ${s.ui.view} is mirrored from view ${mirrorOf(count, s.ui.view)}: copy and paste there`
  const variantId = shownVariant(s, part.id, false) ?? part.defaultVariant
  return { partId: part.id, variantId, view: s.ui.view, image: getPartImage(s.doc, part.id, variantId, s.ui.view) }
}

/** `r` cut to the image, or null when nothing of it is inside. */
function within(r: Rect, img: { width: number; height: number }): Rect | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y)
  const x1 = Math.min(img.width, r.x + r.w), y1 = Math.min(img.height, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

const sameRect = (a: Rect | null, b: Rect | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** The last paste, while it still floats: the image it made, what was under it, and where it sits. */
let floating: { partId: Id; variantId: Id; view: number; image: PartImage; under: PartImage | undefined; clip: PartImage; rect: Rect; shown: Rect } | null = null

/** Copy the selection (or the whole image). With `cut`, it is cleared too. */
export function copySelection(cut = false): boolean {
  const s = editorStore.getState()
  const t = spot(s)
  if (typeof t === 'string') return say(t)
  if (!t.image) return say(`View ${t.view} has no image to ${cut ? 'cut' : 'copy'}`)
  const r = within(s.ui.selection ?? { x: 0, y: 0, w: t.image.width, h: t.image.height }, t.image)
  if (!r) return say('The selection is outside the image')
  clipStore.setState({ clip: { image: cropImage(t.image, r), x: r.x, y: r.y } })
  if (cut) {
    const working = cloneImage(t.image)
    clearRect(working, r)
    s.commitPixels('Cut', t.partId, t.variantId, t.view, t.image, working)
  }
  say(`${cut ? 'Cut' : 'Copied'} ${r.w}×${r.h}`)
  return true
}

/**
 * Paste where it was copied from (kept inside the image), as the selection,
 * with the Move tool picked to drag it. A view with no image gets one.
 */
export function pasteClip(): boolean {
  const clip = clipStore.getState().clip
  if (!clip) return say('Nothing copied yet')
  const s = editorStore.getState()
  const t = spot(s)
  if (typeof t === 'string') return say(t)
  const size = t.image ? { w: t.image.width, h: t.image.height } : newImageSize(s.doc, t.partId, t.variantId)
  const { width: w, height: h } = clip.image
  const rect = { x: Math.max(0, Math.min(clip.x, size.w - w)), y: Math.max(0, Math.min(clip.y, size.h - h)), w, h }
  const working = t.image ? cloneImage(t.image) : createImage(size.w, size.h)
  blitCopy(working, clip.image, rect.x, rect.y)
  s.commitPixels('Paste', t.partId, t.variantId, t.view, t.image, working)
  const shown = within(rect, working)!
  floating = { partId: t.partId, variantId: t.variantId, view: t.view, image: working, under: t.image, clip: clip.image, rect, shown }
  s.setUi({ selection: shown, tool: 'move' })
  say(w > size.w || h > size.h ? `Pasted, cut to the ${size.w}×${size.h} image · drag it into place` : 'Pasted · drag it into place')
  return true
}

/** Select the whole image. */
export function selectAll(): boolean {
  const s = editorStore.getState()
  const t = spot(s)
  if (typeof t === 'string') return say(t)
  if (!t.image) return say(`View ${t.view} has no image yet`)
  s.setUi({ selection: { x: 0, y: 0, w: t.image.width, h: t.image.height } })
  return true
}

/** Clear the selection to transparent; a paste still floating is taken away instead, and what it covered comes back. */
export function clearSelection(): boolean {
  const s = editorStore.getState()
  const t = spot(s)
  if (typeof t === 'string' || !t.image || !s.ui.selection) return false
  const f = floatingOver(t.partId, t.variantId, t.view, t.image, s.ui.selection)
  if (f) {
    s.commitPixels('Delete pasted', t.partId, t.variantId, t.view, t.image, floating!.under)
    floating = null
    s.setUi({ selection: null })
    return true
  }
  const working = cloneImage(t.image)
  clearRect(working, s.ui.selection)
  s.commitPixels('Clear selection', t.partId, t.variantId, t.view, t.image, working)
  return true
}

/**
 * The paste still floating over this image, when the selection is still it:
 * Move lifts it from what was under it, not the pixels it covers.
 */
export function floatingOver(partId: Id, variantId: Id, view: number, image: PartImage | undefined, selection: Rect | null): { base: PartImage; float: PartImage; rect: Rect } | null {
  const f = floating
  if (!f || f.partId !== partId || f.variantId !== variantId || f.view !== view || f.image !== image || !sameRect(f.shown, selection)) return null
  return { base: f.under ? cloneImage(f.under) : createImage(f.image.width, f.image.height), float: f.clip, rect: f.rect }
}

/** After Move dropped a floating paste: it floats on, where it now sits. Returns the selection to show. */
export function floatMoved(delta: { x: number; y: number }): Rect | null {
  const f = floating
  if (!f) return null
  const image = getPartImage(editorStore.getState().doc, f.partId, f.variantId, f.view)
  const rect = { ...f.rect, x: f.rect.x + delta.x, y: f.rect.y + delta.y }
  const shown = image ? within(rect, image) : null
  floating = image && shown ? { ...f, image, rect, shown } : null
  return shown
}

/** For tests: forget the clipboard and any floating paste. */
export function resetClipboard(): void {
  floating = null
  clipStore.setState({ clip: null, note: null })
}
