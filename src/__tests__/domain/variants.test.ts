import { describe, it, expect, beforeEach } from 'vitest'
import { composeFrame } from '../../core/raster/rasterizer'
import { decodeProject, encodeProject } from '../../core/io/projectFile'
import { ensurePartTrack, sampleSwitch, setKey } from '../../domain/animation'
import { createImage } from '../../domain/image'
import { samplePart } from '../../domain/pose'
import { addVariant, createProject, setPartImage } from '../../domain/project'
import type { Project, RGBA } from '../../domain/types'
import { editorStore, shownVariant } from '../../store/editorStore'
import { GREEN, RED } from '../fixtures/pixels'

/** A one-part sprite whose default variant is all red and whose "open" variant is all green. */
function twoVariants(): { p: Project; partId: string; def: string; open: string; anim: string } {
  const p = createProject({ canvasSize: 8, viewCount: 1 })
  const partId = p.partOrder[0]
  const part = p.parts[partId]
  setPartImage(p, partId, part.defaultVariant, 1, createImage(8, 8, RED))
  const open = addVariant(p, partId, 'open')
  setPartImage(p, partId, open.id, 1, createImage(8, 8, GREEN))
  return { p, partId, def: part.defaultVariant, open: open.id, anim: p.animationOrder[0] }
}

/** The one colour a frame is painted in (every pixel the same), as an RGBA. */
function colourOf(px: Uint8ClampedArray): RGBA {
  const c: RGBA = [px[0], px[1], px[2], px[3]]
  for (let i = 0; i < px.length; i += 4) if (px[i] !== c[0] || px[i + 1] !== c[1] || px[i + 2] !== c[2]) throw new Error('more than one colour')
  return c
}

describe('switch tracks (visibility, variant)', () => {
  it('show the value before the first key, then the last key at or before the frame', () => {
    const keys = [{ frame: 2, value: 'b', interp: 'step' as const }, { frame: 5, value: 'c', interp: 'step' as const }]
    expect([0, 1, 2, 3, 4, 5, 6].map(f => sampleSwitch(keys, f, 'a'))).toEqual(['a', 'a', 'b', 'b', 'b', 'c', 'c'])
    expect(sampleSwitch([], 3, 'a')).toBe('a')
  })

  it('a variant keyed partway leaves the frames before it on the default', () => {
    const { p, partId, def, open, anim } = twoVariants()
    const a = p.animations[anim]
    setKey(ensurePartTrack(a, partId).variant, 2, open, 'step')
    expect([0, 1, 2, 3].map(f => samplePart(a, p.parts[partId], f).variantId)).toEqual([def, def, open, open])
    expect([0, 1, 2, 3].map(f => colourOf(composeFrame(p, anim, f, 1)))).toEqual([RED, RED, GREEN, GREEN])
  })

  it('a part hidden partway is visible before the key', () => {
    const { p, partId, anim } = twoVariants()
    const a = p.animations[anim]
    setKey(ensurePartTrack(a, partId).visible, 3, false, 'step')
    expect([0, 2, 3].map(f => samplePart(a, p.parts[partId], f).visible)).toEqual([true, true, false])
  })

  it('a key that switches back to the default ends the stretch, and survives a save', () => {
    const { p, partId, def, open, anim } = twoVariants()
    const t = ensurePartTrack(p.animations[anim], partId)
    setKey(t.variant, 1, open, 'step')
    setKey(t.variant, 3, def, 'step')
    const q = decodeProject(encodeProject(p)).project
    expect([0, 1, 2, 3].map(f => colourOf(composeFrame(q, anim, f, 1)))).toEqual([RED, GREEN, GREEN, RED])
  })
})

describe('new variants', () => {
  it('start as a copy of the variant they are made from, in their own images', () => {
    const { p, partId, open } = twoVariants()
    const copy = addVariant(p, partId, 'open, bloody', open)
    const src = p.parts[partId].variants[open].images[1]
    expect(copy.images[1]).not.toBe(src)
    expect(copy.images[1].pixels).toEqual(src.pixels)
    expect(Object.keys(addVariant(p, partId, 'empty').images)).toEqual([])
  })
})

describe('the variant a canvas shows', () => {
  it('is the one asked for, whatever the animation says', () => {
    const { p, partId, open, anim } = twoVariants()
    expect(colourOf(composeFrame(p, null, 0, 1))).toEqual(RED)
    expect(colourOf(composeFrame(p, null, 0, 1, { variants: { [partId]: open } }))).toEqual(GREEN)
    expect(colourOf(composeFrame(p, anim, 0, 1, { variants: { [partId]: open } }))).toEqual(GREEN)
  })

  describe('in the editor', () => {
    let v: ReturnType<typeof twoVariants>
    beforeEach(() => {
      v = twoVariants()
      setKey(ensurePartTrack(v.p.animations[v.anim], v.partId).variant, 2, v.open, 'step')
      editorStore.getState().loadProject(v.p)
    })

    it('is the one picked in the Parts panel while drawing', () => {
      const s = editorStore.getState()
      expect(shownVariant(s, v.partId)).toBe(v.def)
      s.setUi({ variantId: v.open })
      expect(shownVariant(editorStore.getState(), v.partId)).toBe(v.open)
    })

    it("is the animation's at the frame in Animate, whatever was picked", () => {
      editorStore.getState().setUi({ variantId: v.open, mode: 'animate', animId: v.anim, frame: 1 })
      expect(shownVariant(editorStore.getState(), v.partId)).toBe(v.def)
      editorStore.getState().setUi({ frame: 2 })
      expect(shownVariant(editorStore.getState(), v.partId)).toBe(v.open)
    })
  })
})
