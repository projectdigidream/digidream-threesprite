import { describe, it, expect } from 'vitest'
import { opaqueBounds } from '../../domain/image'
import { IDENTITY34, affine, eulerMatrix, type Mat34 } from '../../domain/math3'
import { createProject } from '../../domain/project'
import { createPrimitive, createSolidsGroup, renderSolids, unitMesh, PRIMITIVE_KINDS } from '../../domain/solids'
import { addPrimitive, addSolidsPart, convertSolidsToPixels, removePrimitive, updatePrimitive, updateShading } from '../../domain/solidsOps'
import type { SolidsGroup } from '../../domain/types'
import { RED, BLUE } from '../fixtures/pixels'

function group(...prims: ReturnType<typeof createPrimitive>[]): SolidsGroup {
  const g = createSolidsGroup()
  g.shading.outline = false
  for (const p of prims) { g.primitives[p.id] = p; g.order.push(p.id) }
  return g
}
const vp = (view: number, elevationDeg = 0) => ({ N: 8, view, size: 32, elevationDeg })
const I: Mat34 = IDENTITY34 as Mat34

describe('unit meshes', () => {
  it('every kind builds a mesh within ±0.5', () => {
    for (const kind of PRIMITIVE_KINDS) {
      const m = unitMesh(kind)
      expect(m.indices.length % 3).toBe(0)
      expect(m.indices.length).toBeGreaterThan(0)
      for (let i = 0; i < m.positions.length; i++) expect(Math.abs(m.positions[i])).toBeLessThanOrEqual(0.5 + 1e-6)
    }
  })
})

describe('renderSolids', () => {
  it('a cube on the ground is a square at the bottom centre in the front view and wider at 45°', () => {
    const g = group(createPrimitive('cube', RED, 10))
    const front = renderSolids(g, I, vp(1))
    expect(opaqueBounds(front.pixels, 32, 32)).toEqual({ x: 11, y: 22, w: 10, h: 10 })
    const diag = renderSolids(g, I, vp(2))
    const bd = opaqueBounds(diag.pixels, 32, 32)!
    expect(bd.w).toBeGreaterThanOrEqual(13)
    expect(bd.w).toBeLessThanOrEqual(15)
    expect(bd.h).toBe(10)
    const row = new Set<string>()
    for (let x = bd.x; x < bd.x + bd.w; x++) { const i = (27 * 32 + x) * 4; row.add(`${diag.pixels[i]},${diag.pixels[i + 1]}`) }
    expect(row.size).toBeGreaterThanOrEqual(2) // two lit faces
  })

  it('a sphere keeps the same silhouette width in every view', () => {
    const g = group(createPrimitive('sphere', BLUE, 12))
    const widths = new Set<number>()
    for (let k = 1; k <= 8; k++) widths.add(opaqueBounds(renderSolids(g, I, vp(k)).pixels, 32, 32)!.w)
    expect(widths.size).toBe(1)
    expect([...widths][0]).toBeGreaterThanOrEqual(11)
  })

  it('occlusion follows depth per view', () => {
    const front = createPrimitive('cube', RED, 10)
    front.position = { r: 0, u: 5, f: 8 }
    const back = createPrimitive('cube', BLUE, 10)
    back.position = { r: 0, u: 5, f: -8 }
    const g = group(front, back)
    const centre = (img: { pixels: Uint8ClampedArray }) => { const i = (27 * 32 + 16) * 4; return [img.pixels[i], img.pixels[i + 2]] }
    const v1 = renderSolids(g, I, vp(1))
    expect(centre(v1)[0]).toBeGreaterThan(centre(v1)[1])
    const v5 = renderSolids(g, I, vp(5))
    expect(centre(v5)[1]).toBeGreaterThan(centre(v5)[0])
  })

  it('the character\'s right hand appears on screen-left in the front view and screen-right from behind', () => {
    const hand = createPrimitive('cube', RED, 6)
    hand.position = { r: 10, u: 3, f: 0 }
    const g = group(hand)
    const v1 = opaqueBounds(renderSolids(g, I, vp(1)).pixels, 32, 32)!
    expect(v1.x + v1.w / 2).toBeLessThan(16)
    const v5 = opaqueBounds(renderSolids(g, I, vp(5)).pixels, 32, 32)!
    expect(v5.x + v5.w / 2).toBeGreaterThan(16)
  })

  it('the bone frame moves and turns the group', () => {
    const cube = createPrimitive('cube', RED, 6)
    cube.position = { r: 0, u: 3, f: 0 }
    const g = group(cube)
    const world = affine(eulerMatrix({ r: 0, u: 0, f: 0 }), { r: 8, u: 10, f: 0 })
    const b = opaqueBounds(renderSolids(g, world, vp(1)).pixels, 32, 32)!
    expect(b.x + b.w / 2).toBeCloseTo(16 - 8, 0)
    expect(b.y + b.h).toBeCloseTo(32 - 10, 0)
    const turned = affine(eulerMatrix({ r: 0, u: 180, f: 0 }), { r: 0, u: 0, f: 0 })
    cube.position = { r: 8, u: 3, f: 0 }
    const bt = opaqueBounds(renderSolids(g, turned, vp(1)).pixels, 32, 32)!
    expect(bt.x + bt.w / 2).toBeGreaterThan(16) // the bone's right now points to the character's left
  })

  it('outline adds a dark rim; elevation reveals the top face', () => {
    const g = group(createPrimitive('cube', RED, 10))
    g.shading.outline = true
    const img = renderSolids(g, I, vp(1))
    const b = opaqueBounds(img.pixels, 32, 32)!
    expect(img.pixels[(b.y * 32 + b.x) * 4]).toBeLessThan(80)
    g.shading.outline = false
    const tilted = renderSolids(g, I, vp(1, 30))
    expect(opaqueBounds(tilted.pixels, 32, 32)!.h).toBeGreaterThan(10)
  })
})

describe('solids parts', () => {
  it('add, edit, remove and bake', () => {
    const p = createProject({ canvasSize: 32, viewCount: 8, mirror: true })
    const part = addSolidsPart(p, p.skeleton.rootOrder[0])
    expect(part.solids).toBeDefined()
    expect(Object.keys(part.variants[part.defaultVariant].images)).toEqual([])
    const prim = addPrimitive(p, part.id, 'sphere', RED, 10)
    expect(prim.name).toBe('sphere')
    expect(addPrimitive(p, part.id, 'sphere', RED, 10).name).toBe('sphere 2')
    updatePrimitive(p, part.id, prim.id, q => { q.position.r = 8 })
    expect(part.solids!.primitives[prim.id].position.r).toBe(8)
    updateShading(p, part.id, { levels: 5 })
    expect(part.solids!.shading.levels).toBe(5)
    removePrimitive(p, part.id, prim.id)
    expect(part.solids!.order).toHaveLength(1)
    convertSolidsToPixels(p, part.id)
    expect(part.solids).toBeUndefined()
    expect(Object.keys(part.variants[part.defaultVariant].images).map(Number)).toEqual([1, 2, 3, 4, 5])
    expect(opaqueBounds(part.variants[part.defaultVariant].images[1].pixels, 32, 32)).not.toBeNull()
  })
})
