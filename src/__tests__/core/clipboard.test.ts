import { beforeEach, describe, expect, it } from 'vitest'
import { clearSelection, clipStore, copySelection, floatingOver, floatMoved, pasteClip, resetClipboard, selectAll } from '../../core/tools/clipboard'
import { blitCopy, cloneImage, createImage, getPixel, setPixel } from '../../domain/image'
import { addVariant, createProject, getPartImage, imageSourcesFor } from '../../domain/project'
import { isDerived } from '../../domain/views'
import { editorStore } from '../../store/editorStore'
import { BLUE, GREEN, RED } from '../fixtures/pixels'

const st = () => editorStore.getState()
const part = () => st().doc.partOrder[0]
const variant = () => st().doc.parts[part()].defaultVariant
const image = (view = st().ui.view) => getPartImage(st().doc, part(), variant(), view)
const note = () => clipStore.getState().note?.text

/** View 1 of the starter part: red at (2,2), green at (3,2). */
beforeEach(() => {
  resetClipboard()
  st().loadProject(createProject({ canvasSize: 16, viewCount: 8, mirror: true }))
  st().selectPart(part())
  const img = createImage(16, 16)
  setPixel(img, 2, 2, RED); setPixel(img, 3, 2, GREEN)
  st().commitPixels('art', part(), variant(), 1, image(1), img)
  st().setUi({ view: 1, mode: 'draw' })
})

describe('copy, cut and paste', () => {
  it('copy the selection, where it was', () => {
    st().setUi({ selection: { x: 2, y: 2, w: 2, h: 1 } })
    expect(copySelection()).toBe(true)
    const clip = clipStore.getState().clip!
    expect([clip.x, clip.y, clip.image.width, clip.image.height]).toEqual([2, 2, 2, 1])
    expect(getPixel(clip.image, 1, 0)).toEqual(GREEN)
    expect(note()).toBe('Copied 2×1')
  })

  it('copy the whole image when nothing is selected', () => {
    copySelection()
    expect(clipStore.getState().clip!.image.width).toBe(16)
  })

  it('cut clears what it copies, in one undoable step', () => {
    st().setUi({ selection: { x: 2, y: 2, w: 1, h: 1 } })
    copySelection(true)
    expect(getPixel(image()!, 2, 2)?.[3]).toBe(0)
    st().undo()
    expect(getPixel(image()!, 2, 2)).toEqual(RED)
  })

  it('paste into an empty view: the image is made, the paste selected, Move picked', () => {
    st().setUi({ selection: { x: 2, y: 2, w: 2, h: 1 } })
    copySelection()
    st().setUi({ view: 2, selection: null })
    expect(image(2)).toBeUndefined()
    expect(pasteClip()).toBe(true)
    expect(getPixel(image(2)!, 3, 2)).toEqual(GREEN)
    expect(st().ui.selection).toEqual({ x: 2, y: 2, w: 2, h: 1 })
    expect(st().ui.tool).toBe('move')
  })

  it('a paste floats: moved, it leaves the art it covered as it was; deleted, the art comes back', () => {
    st().setUi({ selection: { x: 2, y: 2, w: 1, h: 1 } })
    copySelection() // red
    const under = image()!
    const art = cloneImage(under); setPixel(art, 2, 2, BLUE)
    st().commitPixels('blue', part(), variant(), 1, under, art)
    st().setUi({ selection: null })
    pasteClip()
    expect(getPixel(image()!, 2, 2)).toEqual(RED)
    // what the Move tool does with it
    const lifted = floatingOver(part(), variant(), 1, image(), st().ui.selection)!
    expect(lifted).not.toBeNull()
    const moved = cloneImage(lifted.base); blitCopy(moved, lifted.float, lifted.rect.x + 5, lifted.rect.y)
    st().commitPixels('Move', part(), variant(), 1, image(), moved)
    st().setUi({ selection: floatMoved({ x: 5, y: 0 }) })
    expect(getPixel(image()!, 2, 2)).toEqual(BLUE)
    expect(getPixel(image()!, 7, 2)).toEqual(RED)
    expect(clearSelection()).toBe(true)
    expect(getPixel(image()!, 7, 2)?.[3]).toBe(0)
    expect(getPixel(image()!, 2, 2)).toEqual(BLUE)
  })

  it('a new selection, or another edit, ends the float', () => {
    copySelection()
    pasteClip()
    expect(floatingOver(part(), variant(), 1, image(), st().ui.selection)).not.toBeNull()
    expect(floatingOver(part(), variant(), 1, image(), { x: 0, y: 0, w: 2, h: 2 })).toBeNull()
    const edited = cloneImage(image()!); setPixel(edited, 0, 0, BLUE)
    st().commitPixels('draw', part(), variant(), 1, image(), edited)
    expect(floatingOver(part(), variant(), 1, image(), st().ui.selection)).toBeNull()
  })

  it('a mirrored view says where to go instead', () => {
    const N = st().doc.views.count
    const mirrored = Array.from({ length: N }, (_, i) => i + 1).find(v => isDerived(N, true, v))!
    copySelection()
    st().setUi({ view: mirrored })
    expect(pasteClip()).toBe(false)
    expect(note()).toMatch(/is mirrored from view \d+: copy and paste there/)
  })

  it('nothing to paste says so', () => {
    expect(pasteClip()).toBe(false)
    expect(note()).toBe('Nothing copied yet')
  })

  it('select all is the whole image', () => {
    selectAll()
    expect(st().ui.selection).toEqual({ x: 0, y: 0, w: 16, h: 16 })
  })
})

describe('an empty view starts from', () => {
  it("any view of its variant, nearest first, then itself in the other variants", () => {
    const d = st().doc
    const p = part(), v = variant()
    for (const k of [3, 4]) st().commitPixels('art', p, v, k, undefined, createImage(16, 16))
    let other = ''
    st().commit('variant', d => { other = addVariant(d, p, 'open').id })
    st().commitPixels('art', p, other, 2, undefined, createImage(16, 16))
    expect(d).not.toBe(st().doc)
    expect(imageSourcesFor(st().doc, p, v, 2)).toEqual([
      { variantId: v, view: 1 }, { variantId: v, view: 3 }, { variantId: v, view: 4 },
      { variantId: other, view: 2 },
    ])
  })
})
