import { describe, it, expect } from 'vitest'
import { blitNearest, composeFrame, imageKey, partCanvasMatrix, snapMatrix } from '../../core/raster/rasterizer'
import { FrameCache } from '../../core/raster/frameCache'
import { setKey } from '../../domain/animation'
import { createImage, flipXPixels, opaqueBounds } from '../../domain/image'
import { addAnimation, addPart, createProject, ensureBoneTrack, ensurePartTrack, setPartImage } from '../../domain/project'
import { addPrimitive, addSolidsPart } from '../../domain/solidsOps'
import { compose, rotate, scale, translate, IDENTITY } from '../../domain/transform'
import { feetBone, pivotFor } from '../fixtures/bones'
import { ascii, L_ROWS, RED, toAscii } from '../fixtures/pixels'

const canvas = (n: number) => new Uint8ClampedArray(n * n * 4)
const S = 8 // smallest legal canvas
const pad = (rows: string[]) => {
  const out = rows.map(r => r.padEnd(S, '.'))
  while (out.length < S) out.push('.'.repeat(S))
  return out
}

describe('blitNearest goldens', () => {
  it('identity + integer translation is an exact copy', () => {
    const dst = canvas(5)
    blitNearest(dst, 5, 5, ascii(L_ROWS), translate(1, 1))
    expect(toAscii(dst, 5, 5)).toEqual(['.....', '.X...', '.X...', '.XXX.', '.....'])
  })

  it('rotates 90° CCW about the top-left corner exactly', () => {
    const dst = canvas(3)
    blitNearest(dst, 3, 3, ascii(L_ROWS), snapMatrix(compose(translate(0, 3), rotate(90))))
    expect(toAscii(dst, 3, 3)).toEqual(['..X', '..X', 'XXX'])
  })

  it('rotates 180° and 270° exactly', () => {
    const d180 = canvas(3)
    blitNearest(d180, 3, 3, ascii(L_ROWS), snapMatrix(compose(translate(3, 3), rotate(180))))
    expect(toAscii(d180, 3, 3)).toEqual(['XXX', '..X', '..X'])
    const d270 = canvas(3)
    blitNearest(d270, 3, 3, ascii(L_ROWS), snapMatrix(compose(translate(3, 0), rotate(270))))
    expect(toAscii(d270, 3, 3)).toEqual(['XXX', 'X..', 'X..'])
  })

  it('scale(-1, 1) about the right edge is a horizontal flip', () => {
    const dst = canvas(3)
    blitNearest(dst, 3, 3, ascii(L_ROWS), snapMatrix(compose(translate(3, 0), scale(-1, 1))))
    expect(toAscii(dst, 3, 3)).toEqual(['..X', '..X', 'XXX'])
    expect(Array.from(dst)).toEqual(Array.from(flipXPixels(ascii(L_ROWS).pixels, 3, 3)))
  })

  it('2× scale turns each source pixel into a 2×2 block', () => {
    const dst = canvas(6)
    blitNearest(dst, 6, 6, ascii(['X.', '.G']), scale(2, 2))
    expect(toAscii(dst, 6, 6)).toEqual(['XX....', 'XX....', '..GG..', '..GG..', '......', '......'])
  })

  it('clips at the canvas edges', () => {
    const dst = canvas(3)
    blitNearest(dst, 3, 3, ascii(L_ROWS), translate(-1, 1))
    expect(toAscii(dst, 3, 3)).toEqual(['...', '...', '...'])
    const dst2 = canvas(3)
    blitNearest(dst2, 3, 3, ascii(L_ROWS), translate(-1, 0))
    expect(toAscii(dst2, 3, 3)).toEqual(['...', '...', 'XX.'])
    const dst3 = canvas(3)
    blitNearest(dst3, 3, 3, ascii(L_ROWS), translate(2, 2))
    expect(toAscii(dst3, 3, 3)).toEqual(['...', '...', '..X'])
  })

  it('45° rotation is a nearest-neighbour rotation about the pivot', () => {
    const dst = canvas(7)
    const img = ascii(['XX', 'XX'])
    blitNearest(dst, 7, 7, img, snapMatrix(compose(translate(3, 3), rotate(45), translate(-1, -1))))
    const rows = toAscii(dst, 7, 7)
    expect(rows[2][3]).toBe('X')
    expect(rows[3][3]).toBe('X')
    let count = 0
    for (let i = 3; i < dst.length; i += 4) if (dst[i]) count++
    expect(count).toBeGreaterThanOrEqual(2)
    expect(count).toBeLessThanOrEqual(6)
  })

  it('blends straight alpha and honours alphaMul', () => {
    const dst = canvas(1)
    dst.set([0, 0, 255, 255])
    const img = { width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 128]) }
    blitNearest(dst, 1, 1, img, IDENTITY)
    expect(dst[3]).toBe(255)
    expect(dst[0]).toBeGreaterThan(120); expect(dst[0]).toBeLessThan(136)
    expect(dst[2]).toBeGreaterThan(120); expect(dst[2]).toBeLessThan(136)
    const dst2 = canvas(1)
    blitNearest(dst2, 1, 1, { width: 1, height: 1, pixels: new Uint8ClampedArray(RED) }, IDENTITY, 0.5)
    expect(dst2[3]).toBeGreaterThan(120); expect(dst2[3]).toBeLessThan(136)
  })

  it('skips singular matrices without throwing', () => {
    const dst = canvas(2)
    blitNearest(dst, 2, 2, ascii(['X']), scale(0, 1))
    expect(Array.from(dst)).toEqual(new Array(16).fill(0))
  })
})

/** Two pixel parts on the feet bone, pivots chosen so images land at canvas (0,0) and (1,1) in every view. */
function twoPartProject() {
  const p = createProject({ canvasSize: S, viewCount: 8, mirror: true, starter: false })
  const bone = feetBone(p)
  const a = addPart(p, { boneId: bone.id, name: 'a', image: ascii(['XX', 'XX']), pivot: pivotFor(p, 0, 0) })
  const b = addPart(p, { boneId: bone.id, name: 'b', image: ascii(['G']), pivot: pivotFor(p, 1, 1) })
  return { p, bone, a, b }
}

describe('composeFrame', () => {
  it('draws parts in painter order, identically in every view for a bone on the vertical axis', () => {
    const { p } = twoPartProject()
    expect(toAscii(composeFrame(p, null, 0, 1), S, S)).toEqual(pad(['XX', 'XG']))
    expect(toAscii(composeFrame(p, null, 0, 3), S, S)).toEqual(pad(['..', '..']))
    const m = partCanvasMatrix(p, null, 0, p.partOrder[0], 3)!
    expect([m.a, m.b, m.c, m.d, m.tx, m.ty].map(v => v + 0)).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('a hidden part or a missing view image is skipped; derived views are flipped composites', () => {
    const { p, a, b } = twoPartProject()
    setPartImage(p, a.id, a.defaultVariant, 2, ascii(['B.', '..']))
    expect(toAscii(composeFrame(p, null, 0, 2), S, S)).toEqual(pad(['B']))
    expect(toAscii(composeFrame(p, null, 0, 8), S, S)).toEqual(pad(['.......B']))
    const anim = addAnimation(p, { frameCount: 2 })
    const vis = ensurePartTrack(anim, b.id).visible
    setKey(vis, 0, true, 'step')
    setKey(vis, 1, false, 'step')
    expect(toAscii(composeFrame(p, anim.id, 0, 1), S, S)).toEqual(pad(['XX', 'XG']))
    expect(toAscii(composeFrame(p, anim.id, 1, 1), S, S)).toEqual(pad(['XX', 'XX']))
  })

  it('mirror-derived view equals flipX of the authored composite for several N', () => {
    for (const N of [4, 6, 7, 8, 16]) {
      const p = createProject({ canvasSize: S, viewCount: N, mirror: true, starter: false })
      const bone = feetBone(p)
      const part = addPart(p, { boneId: bone.id, image: ascii(['XG.', '.B.']), pivot: pivotFor(p, 1, 1) })
      setPartImage(p, part.id, part.defaultVariant, 2, ascii(['X..', 'GB.']))
      const authored = composeFrame(p, null, 0, 2)
      const derived = composeFrame(p, null, 0, N)
      expect(toAscii(authored, S, S)[1]).toBe('.X......')
      expect(Array.from(derived)).toEqual(Array.from(flipXPixels(authored, S, S)))
    }
  })

  it('overrides replace a part image for the composite only; dim ghosts other parts', () => {
    const { p, a, b } = twoPartProject()
    const overrides = new Map([[imageKey(a.id, a.defaultVariant, 1), ascii(['..', '.B'])]])
    expect(toAscii(composeFrame(p, null, 0, 1, { overrides }), S, S)).toEqual(pad(['..', '.G']))
    const dimmed = composeFrame(p, null, 0, 1, { dim: { except: b.id, alpha: 0.5 } })
    expect(dimmed[3]).toBeGreaterThan(100); expect(dimmed[3]).toBeLessThan(140)
    expect(dimmed[(1 * S + 1) * 4 + 3]).toBe(255)
  })

  it('animation moves the part with snapping', () => {
    const p = createProject({ canvasSize: S, starter: false })
    const bone = feetBone(p)
    addPart(p, { boneId: bone.id, image: ascii(['X']), pivot: pivotFor(p, 0, 0) })
    const anim = addAnimation(p, { frameCount: 3 })
    const t = ensureBoneTrack(anim, bone.id)
    setKey(t.translate, 0, { r: 0, u: 0, f: 0 })
    setKey(t.translate, 2, { r: -3, u: -1, f: 0 }) // 3 px screen-right, 1 px down
    expect(toAscii(composeFrame(p, anim.id, 0, 1), S, S)).toEqual(pad(['X']))
    expect(toAscii(composeFrame(p, anim.id, 1, 1), S, S)).toEqual(pad(['..', '..X']))
    expect(toAscii(composeFrame(p, anim.id, 2, 1), S, S)).toEqual(pad(['..', '...X']))
  })

  it('renders solids parts live in the bone frame, consistently across views', () => {
    const p = createProject({ canvasSize: 32, viewCount: 8, mirror: false, starter: false })
    const root = feetBone(p, 10)
    const part = addSolidsPart(p, root.id)
    const prim = addPrimitive(p, part.id, 'cube', RED, 10)
    prim.position = { r: 8, u: 5, f: 0 }
    part.solids!.shading.outline = false
    const front = opaqueBounds(composeFrame(p, null, 0, 1), 32, 32)!
    expect(front.x + front.w / 2).toBeLessThan(16) // the character's right → screen-left
    const back = opaqueBounds(composeFrame(p, null, 0, 5), 32, 32)!
    expect(back.x + back.w / 2).toBeGreaterThan(16)
    // animating the bone moves the solid with it
    const anim = addAnimation(p, { frameCount: 2 })
    setKey(ensureBoneTrack(anim, root.id).rotation, 1, { r: 0, u: 180, f: 0 }) // half turn about up
    const turned = opaqueBounds(composeFrame(p, anim.id, 1, 1), 32, 32)!
    expect(turned.x + turned.w / 2).toBeGreaterThan(16)
    expect(partCanvasMatrix(p, null, 0, part.id, 1)).toBeNull()
  })

  it('is deterministic and reuses the out buffer', () => {
    const { p } = twoPartProject()
    const a = composeFrame(p, null, 0, 1)
    const out = createImage(S, S).pixels
    out.fill(7)
    const b = composeFrame(p, null, 0, 1, { out })
    expect(b).toBe(out)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('FrameCache', () => {
  it('caches per revision', () => {
    const { p, b } = twoPartProject()
    let rev = 1
    const cache = new FrameCache(() => p, () => rev)
    const f1 = cache.get(null, 0, 1)
    expect(cache.get(null, 0, 1)).toBe(f1)
    expect(cache.size).toBe(1)
    p.parts[b.id].pivot = pivotFor(p, 0, 0)
    expect(cache.get(null, 0, 1)).toBe(f1)
    rev++
    const f2 = cache.get(null, 0, 1)
    expect(toAscii(f2, S, S)).toEqual(pad(['GX', 'XX']))
    cache.prune()
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})
