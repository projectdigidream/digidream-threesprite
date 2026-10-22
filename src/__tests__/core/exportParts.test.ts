import { describe, it, expect } from 'vitest'
import { planExport, scopedProject } from '../../core/export/plan'
import { collectFrames } from '../../core/io/exportBundle'
import { DEFAULT_OPTIONS } from '../../core/export/types'
import { createImage } from '../../domain/image'
import { addPart, createProject } from '../../domain/project'
import { RED, BLUE } from '../fixtures/pixels'

/** Body (red, left half) and sword (blue, right half) on one bone, two animations. */
function doll() {
  const p = createProject({ canvasSize: 8, viewCount: 1, spriteName: 'KNIGHT' })
  const body = p.partOrder[0]
  const bone = p.parts[body].boneId
  p.parts[body].variants[p.parts[body].defaultVariant].images[1] = createImage(8, 8)
  const img = p.parts[body].variants[p.parts[body].defaultVariant].images[1]
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) img.pixels.set(RED, (y * 8 + x) * 4)
  const sword = addPart(p, { name: 'sword', boneId: bone, width: 8, height: 8, pivot: { x: 4, y: 8 } })
  const simg = sword.variants[sword.defaultVariant].images[1]
  for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) simg.pixels.set(BLUE, (y * 8 + x) * 4)
  return { p, body, sword: sword.id }
}
const colours = (px: Uint8ClampedArray) => new Set(Array.from({ length: px.length / 4 }, (_, i) => px[i * 4 + 3] ? `${px[i * 4]},${px[i * 4 + 2]}` : null).filter(Boolean))

describe('exporting some parts on their own', () => {
  it('composes only the ticked parts, every animation and frame kept', () => {
    const { p, sword } = doll()
    const sel = { format: 'atlas' as const, animIds: p.animationOrder, options: DEFAULT_OPTIONS, parts: [sword], spriteName: 'KNIGHT_SWORD' }
    const scoped = scopedProject(p, sel)
    const all = collectFrames(p, p.animationOrder)
    const some = collectFrames(scoped, p.animationOrder)
    expect(some.frames.length).toBe(all.frames.length)
    expect([...colours(some.buffers[0])]).toEqual(['0,255'])
    expect(colours(all.buffers[0]).size).toBe(2)
    expect(p.partOrder.length).toBe(2) // the project itself is untouched
  })

  it('names the files after the id given, and refuses an empty choice', () => {
    const { p, sword } = doll()
    const sel = { format: 'atlas' as const, animIds: p.animationOrder, options: DEFAULT_OPTIONS, parts: [sword], spriteName: 'KNIGHT_SWORD' }
    expect(planExport(scopedProject(p, sel), sel).files.map(f => f.name).join()).toMatch(/KNIGHT_SWORD/)
    expect(planExport(p, { ...sel, parts: [] }).errors.join()).toMatch(/No parts are ticked/)
  })
})
