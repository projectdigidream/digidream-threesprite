import { describe, it, expect, beforeEach } from 'vitest'
import { createImage, getPixel, setPixel } from '../../domain/image'
import { activePalette, recolorProject } from '../../domain/palette'
import { addPalette, addPart, createProject, removePart } from '../../domain/project'
import { editorStore, HISTORY_CAP } from '../../store/editorStore'
import { BLUE, GREEN, RED } from '../fixtures/pixels'

describe('editorStore', () => {
  beforeEach(() => {
    editorStore.getState().loadProject(createProject({ canvasSize: 16, name: 'T' }))
  })

  it('commit records patches and undo/redo restore the document', () => {
    const s = editorStore.getState()
    const rev0 = s.revision
    const ok = s.commit('rename', d => { d.name = 'Renamed' })
    expect(ok).toBe(true)
    expect(editorStore.getState().doc.name).toBe('Renamed')
    expect(editorStore.getState().revision).toBe(rev0 + 1)
    expect(editorStore.getState().dirty).toBe(true)
    editorStore.getState().undo()
    expect(editorStore.getState().doc.name).toBe('T')
    editorStore.getState().redo()
    expect(editorStore.getState().doc.name).toBe('Renamed')
  })

  it('a no-op commit records nothing', () => {
    const s = editorStore.getState()
    expect(s.commit('nothing', () => {})).toBe(false)
    expect(editorStore.getState().history.undo).toHaveLength(0)
  })

  it('commitPixels swaps image buffers and is undoable, including image creation', () => {
    const s = editorStore.getState()
    const partId = s.doc.partOrder[0]
    const vid = s.doc.parts[partId].defaultVariant
    const before = s.doc.parts[partId].variants[vid].images[1]
    const after = createImage(16, 16)
    setPixel(after, 3, 3, RED)
    s.commitPixels('draw', partId, vid, 1, before, after)
    expect(editorStore.getState().doc.parts[partId].variants[vid].images[1]).toBe(after)
    // create for a new view
    const created = createImage(16, 16)
    editorStore.getState().commitPixels('create', partId, vid, 2, undefined, created)
    expect(editorStore.getState().doc.parts[partId].variants[vid].images[2]).toBe(created)
    editorStore.getState().undo()
    expect(editorStore.getState().doc.parts[partId].variants[vid].images[2]).toBeUndefined()
    editorStore.getState().undo()
    expect(editorStore.getState().doc.parts[partId].variants[vid].images[1]).toBe(before)
    editorStore.getState().redo()
    expect(editorStore.getState().doc.parts[partId].variants[vid].images[1]).toBe(after)
  })

  it('reconciles ui after an undo removes the selected part', () => {
    const s = editorStore.getState()
    let newId = ''
    s.commit('add', d => { newId = addPart(d, { boneId: d.skeleton.rootOrder[0] }).id })
    editorStore.getState().selectPart(newId)
    expect(editorStore.getState().ui.selectedPartId).toBe(newId)
    editorStore.getState().undo()
    expect(editorStore.getState().doc.parts[newId]).toBeUndefined()
    expect(editorStore.getState().ui.selectedPartId).toBe(editorStore.getState().doc.partOrder[0])
    expect(editorStore.getState().ui.variantId).toBe(editorStore.getState().doc.parts[editorStore.getState().doc.partOrder[0]].defaultVariant)
  })

  it('removing every part leaves a null selection', () => {
    const s = editorStore.getState()
    s.commit('remove', d => removePart(d, d.partOrder[0]))
    expect(editorStore.getState().ui.selectedPartId).toBeNull()
    expect(editorStore.getState().ui.variantId).toBeNull()
  })

  it('caps the history', () => {
    const s = editorStore.getState()
    for (let i = 0; i < HISTORY_CAP + 20; i++) s.commit('n', d => { d.name = `n${i}` })
    expect(editorStore.getState().history.undo).toHaveLength(HISTORY_CAP)
  })

  it('setUi clamps frame and view to the document', () => {
    const s = editorStore.getState()
    s.setUi({ frame: 99, view: 99 })
    expect(editorStore.getState().ui.frame).toBe(3)
    expect(editorStore.getState().ui.view).toBe(8)
    s.setUi({ frame: -5, view: 0 })
    expect(editorStore.getState().ui.frame).toBe(0)
    expect(editorStore.getState().ui.view).toBe(1)
  })
})

describe('editorStore palettes', () => {
  beforeEach(() => {
    editorStore.getState().loadProject(createProject({ canvasSize: 16, name: 'T' }))
  })

  it('recolouring pixels inside a commit is undoable (buffers are copied, never edited in place)', () => {
    const s = editorStore.getState()
    const partId = s.doc.partOrder[0]
    const vid = s.doc.parts[partId].defaultVariant
    const img = createImage(16, 16)
    setPixel(img, 1, 1, RED)
    setPixel(img, 2, 2, GREEN)
    s.commitPixels('draw', partId, vid, 1, s.doc.parts[partId].variants[vid].images[1], img)
    const before = editorStore.getState().doc.parts[partId].variants[vid].images[1]
    expect(editorStore.getState().commit('recolour', d => { recolorProject(d, RED, BLUE) })).toBe(true)
    const after = editorStore.getState().doc.parts[partId].variants[vid].images[1]
    expect(after).not.toBe(before)
    expect(getPixel(after, 1, 1)).toEqual(BLUE)
    expect(getPixel(after, 2, 2)).toEqual(GREEN)
    expect(getPixel(before, 1, 1)).toEqual(RED)
    editorStore.getState().undo()
    expect(getPixel(editorStore.getState().doc.parts[partId].variants[vid].images[1], 1, 1)).toEqual(RED)
    editorStore.getState().redo()
    expect(getPixel(editorStore.getState().doc.parts[partId].variants[vid].images[1], 1, 1)).toEqual(BLUE)
  })

  it('a live colour edit previews without touching history and commits once', () => {
    const s = editorStore.getState()
    const palId = s.doc.activePaletteId
    const from = activePalette(s.doc).colors[0]
    s.beginPreview()
    s.preview(d => { d.palettes[palId].colors[0] = [1, 1, 1, 255] })
    s.preview(d => { d.palettes[palId].colors[0] = [2, 2, 2, 255] })
    expect(activePalette(editorStore.getState().doc).colors[0]).toEqual([2, 2, 2, 255])
    expect(editorStore.getState().history.undo).toHaveLength(0)
    s.endPreview('Edit colour', d => { d.palettes[palId].colors[0] = [3, 3, 3, 255] })
    expect(activePalette(editorStore.getState().doc).colors[0]).toEqual([3, 3, 3, 255])
    expect(editorStore.getState().history.undo).toHaveLength(1)
    editorStore.getState().undo()
    expect(activePalette(editorStore.getState().doc).colors[0]).toEqual(from)
  })

  it('a fresh project picks its brush colours from the active palette', () => {
    const p = createProject({ canvasSize: 16 })
    const pal = addPalette(p, 'Two', [[9, 8, 7, 255], [6, 5, 4, 255]])
    p.activePaletteId = pal.id
    editorStore.getState().loadProject(p)
    expect(editorStore.getState().ui.primary).toEqual([6, 5, 4, 255])
    expect(editorStore.getState().ui.secondary).toEqual([9, 8, 7, 255])
  })
})
