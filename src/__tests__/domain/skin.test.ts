import { describe, it, expect } from 'vitest'
import { composeFrame } from '../../core/raster/rasterizer'
import { setKey } from '../../domain/animation'
import { createImage, opaqueBounds, setPixel } from '../../domain/image'
import { evalPose, partMatrix, projectBone, viewProj } from '../../domain/pose'
import { addAnimation, addBone, addPart, createProject, ensureBoneTrack, removeBone, setPartSkin, validate } from '../../domain/project'
import { buildSkinGrid, deformGrid, gridIsAtRest, influence } from '../../domain/skin'
import { RED, BLUE, GREEN } from '../fixtures/pixels'

/** An arm: upper bone up from the feet, forearm continuing up; one image spanning both. */
function armProject() {
  const p = createProject({ canvasSize: 64, viewCount: 1, mirror: false, starter: false })
  const upper = addBone(p, { name: 'upper', length: 20 })
  const fore = addBone(p, { name: 'fore', parentId: upper.id, rest: { position: { u: 20 } }, length: 20 })
  // 6 px wide, 40 px tall image: bottom half red (upper arm), top half blue (forearm), one green pixel at the very top
  const img = createImage(6, 40)
  for (let y = 0; y < 40; y++) for (let x = 0; x < 6; x++) setPixel(img, x, y, y >= 20 ? RED : BLUE)
  setPixel(img, 3, 0, GREEN)
  const part = addPart(p, { boneId: upper.id, image: img, pivot: { x: 3, y: 40 } })
  setPartSkin(p, part.id, { bones: [fore.id], falloff: 12, cell: 4 })
  return { p, upper, fore, part }
}

describe('skin weights', () => {
  it('influence is 1 on the bone and 0 beyond the falloff', () => {
    expect(influence(0, 10)).toBe(1)
    expect(influence(5, 10)).toBeCloseTo(0.25)
    expect(influence(10, 10)).toBe(0)
    expect(influence(50, 10)).toBe(0)
  })

  it('vertices near one bone follow it alone, the joint blends both', () => {
    const { p, upper, fore, part } = armProject()
    const vp = viewProj(p, 1)
    const rest = evalPose(p.skeleton, null, 0)
    const rp = [projectBone(rest.get(upper.id)!, 20, vp), projectBone(rest.get(fore.id)!, 20, vp)]
    const img = part.variants[part.defaultVariant].images[1]
    const grid = buildSkinGrid(img, partMatrix(rp[0], rp[0], part), rp, 12, 4)
    expect(grid.cols).toBe(2)
    expect(grid.rows).toBe(10)
    const w = (i: number, j: number, b: number) => grid.weights[(j * 3 + i) * 2 + b]
    expect(w(1, 10, 0)).toBeCloseTo(1) // bottom of the image: upper arm only
    expect(w(1, 10, 1)).toBeCloseTo(0)
    expect(w(1, 0, 1)).toBeCloseTo(1) // top: forearm only
    expect(w(1, 5, 0)).toBeCloseTo(0.5, 1) // the elbow row (image y = 20 ↔ bone joint): half and half
    // at rest nothing moves
    const pos = deformGrid(grid, rp, rp, true)
    expect(gridIsAtRest(grid, pos)).toBe(true)
  })
})

describe('skinned rendering', () => {
  it('at rest matches the rigid blit exactly', () => {
    const { p, part } = armProject()
    const skinned = composeFrame(p, null, 0, 1)
    delete p.parts[part.id].skin
    const rigid = composeFrame(p, null, 0, 1)
    expect(Array.from(skinned)).toEqual(Array.from(rigid))
  })

  it('bending the forearm moves the top of the image sideways while the bottom stays', () => {
    const { p, fore } = armProject()
    const anim = addAnimation(p, { frameCount: 2 })
    setKey(ensureBoneTrack(anim, fore.id).rotation, 1, { r: 0, u: 0, f: -90 }) // forearm folds to screen-right
    const bent = composeFrame(p, anim.id, 1, 1)
    const at = (x: number, y: number) => { const i = (y * 64 + x) * 4; return [bent[i], bent[i + 1], bent[i + 2], bent[i + 3]] }
    // bottom of the upper arm unchanged (red at the feet centre)
    expect(at(32, 62)).toEqual([255, 0, 0, 255])
    // the green tip pixel used to be at the top centre (32, 24); now it is to the right at the elbow's height
    let green: { x: number; y: number } | null = null
    for (let y = 0; y < 64 && !green; y++) for (let x = 0; x < 64; x++) { const c = at(x, y); if (c[1] === 255 && c[0] === 0 && c[3] === 255) { green = { x, y }; break } }
    expect(green).not.toBeNull()
    expect(green!.x).toBeGreaterThan(44)
    expect(green!.y).toBeGreaterThan(36)
    expect(green!.y).toBeLessThan(52)
    // still one connected image: the blue region reaches from the elbow to the tip without a gap
    const b = opaqueBounds(bent, 64, 64)!
    expect(b.w).toBeGreaterThan(20)
  })

  it('moving the forearm away stretches the image', () => {
    const { p, fore } = armProject()
    const anim = addAnimation(p, { frameCount: 2 })
    setKey(ensureBoneTrack(anim, fore.id).translate, 1, { r: 0, u: 12, f: 0 })
    const stretched = composeFrame(p, anim.id, 1, 1)
    const b = opaqueBounds(stretched, 64, 64)!
    expect(b.h).toBeGreaterThanOrEqual(50)
    expect(b.h).toBeLessThanOrEqual(53)
  })

  it('removing a bone drops it from skins; setPartSkin validates', () => {
    const { p, fore, part } = armProject()
    expect(validate(p)).toEqual([])
    setPartSkin(p, part.id, { bones: [fore.id, part.boneId, 'nope'] })
    expect(p.parts[part.id].skin?.bones).toEqual([fore.id])
    removeBone(p, fore.id)
    expect(p.parts[part.id].skin).toBeDefined()
    expect(p.parts[part.id].skin?.bones).toEqual([])
    setPartSkin(p, part.id, { bones: [] })
    expect(p.parts[part.id].skin).toBeUndefined()
  })
})
