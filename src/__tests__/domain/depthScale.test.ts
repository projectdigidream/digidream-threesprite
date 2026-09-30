import { describe, it, expect } from 'vitest'
import { composeFrame } from '../../core/raster/rasterizer'
import { setKey } from '../../domain/animation'
import { createImage, opaqueBounds, setPixel } from '../../domain/image'
import { depthFactor, DEPTH_SCALE_MAX, DEPTH_SCALE_MIN, type ViewProj } from '../../domain/math3'
import { addAnimation, addBone, addPart, clampDepthScale, createProject, ensureBoneTrack, MAX_DEPTH_SCALE, setPartSkin, setViews, validate } from '../../domain/project'
import { unzipSync, zipSync } from 'fflate'
import { decodeProject, encodeProject } from '../../core/io/projectFile'
import { addPrimitive, addSolidsPart } from '../../domain/solidsOps'
import { BLUE, RED } from '../fixtures/pixels'

const vp = (depthStrength?: number): ViewProj => ({ N: 1, view: 1, size: 64, elevationDeg: 0, depthStrength })

describe('depthFactor', () => {
  it('leaves a flat view alone', () => {
    expect(depthFactor(0, 40, vp())).toBe(1)
    expect(depthFactor(0, 40, vp(0))).toBe(1)
    expect(depthFactor(0, -40, vp(0))).toBe(1)
  })

  it('is a perspective divide over the travel, in canvas heights', () => {
    expect(depthFactor(0, 16, vp(1))).toBeCloseTo(4 / 3) // a quarter of a canvas closer
    expect(depthFactor(0, -16, vp(1))).toBeCloseTo(0.8)
    expect(depthFactor(0, 8, vp(1))).toBeCloseTo(8 / 7)
  })

  it('counts the travel, not where the thing sits', () => {
    expect(depthFactor(100, 116, vp(1))).toBeCloseTo(depthFactor(0, 16, vp(1)))
    expect(depthFactor(-50, -34, vp(1))).toBeCloseTo(depthFactor(0, 16, vp(1)))
  })

  it('is exactly 1 when nothing moved in depth, whatever the depth', () => {
    for (const d of [-30, 0, 12, 55]) expect(depthFactor(d, d, vp(8))).toBe(1)
  })

  it('the strength multiplies the travel', () => {
    expect(depthFactor(0, 4, vp(4))).toBeCloseTo(depthFactor(0, 16, vp(1)))
    expect(depthFactor(0, 2, vp(8))).toBeCloseTo(depthFactor(0, 16, vp(1)))
    // which is the whole point: a sprite's few pixels of travel need a big strength to read
    expect(depthFactor(0, 3.5, vp(1))).toBeLessThan(1.06)
    expect(depthFactor(0, 3.5, vp(8))).toBeGreaterThan(1.5)
  })

  it('never inverts or runs away', () => {
    expect(depthFactor(0, 64, vp(1))).toBe(DEPTH_SCALE_MAX) // a whole canvas of travel
    expect(depthFactor(0, 200, vp(1))).toBe(DEPTH_SCALE_MAX)
    expect(depthFactor(0, 10, vp(MAX_DEPTH_SCALE))).toBe(DEPTH_SCALE_MAX)
    expect(depthFactor(0, -1e6, vp(1))).toBe(DEPTH_SCALE_MIN)
  })
})

describe('the depth scaling setting', () => {
  it('clamps to off or a usable strength', () => {
    expect(clampDepthScale(0)).toBe(0)
    expect(clampDepthScale(-3)).toBe(0)
    expect(clampDepthScale(Number.NaN)).toBe(0)
    expect(clampDepthScale(999)).toBe(MAX_DEPTH_SCALE)
    expect(clampDepthScale(2.5)).toBe(2.5)
    expect(clampDepthScale(7.77)).toBe(7.8)
  })

  it('carries a file saved with the first shape of the setting across', () => {
    const p = createProject({ canvasSize: 32, viewCount: 4, mirror: false, starter: true })
    const zip = unzipSync(encodeProject(p))
    const raw = JSON.parse(new TextDecoder().decode(zip['project.json']))
    delete raw.views.depthScale
    raw.views.cameraDistance = 2 // the camera two canvas heights away it once shipped as
    zip['project.json'] = new TextEncoder().encode(JSON.stringify(raw))
    const { project: q, warnings } = decodeProject(zipSync(zip))
    expect(warnings).toEqual([])
    expect(q.views.depthScale).toBe(0.5) // the strength that draws the same
    expect('cameraDistance' in q.views).toBe(false)
  })

  it('defaults to off and rides through setViews', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    expect(p.views.depthScale).toBe(0)
    setViews(p, 8, true, 0, 6)
    expect(p.views.depthScale).toBe(6)
    setViews(p, 8, true, 0) // left out: kept
    expect(p.views.depthScale).toBe(6)
    expect(validate(p)).toEqual([])
  })
})

/** A bar hanging off one bone, animated `f` pixels towards the camera on frame 1. */
function barProject(depthScale: number, f: number) {
  const p = createProject({ canvasSize: 64, viewCount: 1, mirror: false, starter: false })
  p.views.depthScale = depthScale
  const bone = addBone(p, { name: 'arm', length: 20 })
  const img = createImage(8, 20)
  for (let y = 0; y < 20; y++) for (let x = 0; x < 8; x++) setPixel(img, x, y, RED)
  addPart(p, { boneId: bone.id, image: img, pivot: { x: 4, y: 20 } })
  const anim = addAnimation(p, { frameCount: 2 })
  const track = ensureBoneTrack(anim, bone.id).translate
  setKey(track, 0, { r: 0, u: 0, f: 0 })
  setKey(track, 1, { r: 0, u: 0, f })
  return { p, anim }
}

const bounds = (px: Uint8ClampedArray) => opaqueBounds(px, 64, 64)!

describe('a rigid part in depth', () => {
  it('draws the rest pose pixel for pixel as a flat project does', () => {
    const flat = barProject(0, 16)
    const deep = barProject(1, 16)
    expect(Array.from(composeFrame(deep.p, deep.anim.id, 0, 1))).toEqual(Array.from(composeFrame(flat.p, flat.anim.id, 0, 1)))
  })

  it('is untouched by depth while the camera distance is off', () => {
    const { p, anim } = barProject(0, 16)
    expect(Array.from(composeFrame(p, anim.id, 1, 1))).toEqual(Array.from(composeFrame(p, anim.id, 0, 1)))
  })

  it('grows when the bone comes towards the camera, about the bone\'s root', () => {
    const { p, anim } = barProject(1, 16) // a quarter of the canvas closer ⇒ 4/3
    const rest = bounds(composeFrame(p, anim.id, 0, 1))
    const near = bounds(composeFrame(p, anim.id, 1, 1))
    expect(rest.w).toBe(8)
    expect(near.w / rest.w).toBeCloseTo(4 / 3, 1)
    expect(near.h / rest.h).toBeCloseTo(4 / 3, 1)
    // the root is at the feet and stays there; the part spreads around it
    expect(near.y + near.h).toBe(rest.y + rest.h)
    // a span of 11 px cannot sit symmetrically on an 8 px one, but it must not drift
    expect(Math.abs((near.x + near.w / 2) - (rest.x + rest.w / 2))).toBeLessThanOrEqual(0.5)
  })

  it('shrinks when it moves away', () => {
    const { p, anim } = barProject(1, -16) // ⇒ 0.8
    const rest = bounds(composeFrame(p, anim.id, 0, 1))
    const far = bounds(composeFrame(p, anim.id, 1, 1))
    expect(rest.w).toBe(8)
    expect(far.w).toBeGreaterThanOrEqual(6) // 8 × 0.8, give or take the pixel grid
    expect(far.w).toBeLessThanOrEqual(7)
    expect(far.y + far.h).toBe(rest.y + rest.h)
  })

  it('a weaker strength makes the same move milder', () => {
    const close = barProject(1, 16)
    const far = barProject(0.25, 16) // a quarter of the travel
    const near = bounds(composeFrame(close.p, close.anim.id, 1, 1))
    const mild = bounds(composeFrame(far.p, far.anim.id, 1, 1))
    expect(mild.w).toBeLessThan(near.w)
    expect(mild.w).toBeGreaterThanOrEqual(8)
  })
})

/** Upper arm + forearm under one image, the forearm alone moving in depth. */
function armProject(depthScale: number) {
  const p = createProject({ canvasSize: 64, viewCount: 1, mirror: false, starter: false })
  p.views.depthScale = depthScale
  const upper = addBone(p, { name: 'upper', length: 20 })
  const fore = addBone(p, { name: 'fore', parentId: upper.id, rest: { position: { u: 20 } }, length: 20 })
  const img = createImage(6, 40)
  for (let y = 0; y < 40; y++) for (let x = 0; x < 6; x++) setPixel(img, x, y, y >= 20 ? RED : BLUE)
  const part = addPart(p, { boneId: upper.id, image: img, pivot: { x: 3, y: 40 } })
  setPartSkin(p, part.id, { bones: [fore.id], falloff: 12, cell: 4 })
  const anim = addAnimation(p, { frameCount: 2 })
  const track = ensureBoneTrack(anim, fore.id).translate
  setKey(track, 0, { r: 0, u: 0, f: 0 })
  setKey(track, 1, { r: 0, u: 0, f: 16 })
  return { p, anim }
}

/** How many opaque pixels sit in one row. */
function rowWidth(px: Uint8ClampedArray, y: number): number {
  let n = 0
  for (let x = 0; x < 64; x++) if (px[(y * 64 + x) * 4 + 3] > 0) n++
  return n
}

describe('a skinned part in depth', () => {
  it('at rest matches the flat project exactly', () => {
    const flat = armProject(0)
    const deep = armProject(1)
    expect(Array.from(composeFrame(deep.p, deep.anim.id, 0, 1))).toEqual(Array.from(composeFrame(flat.p, flat.anim.id, 0, 1)))
  })

  it('swells only the end that came forward', () => {
    const { p, anim } = armProject(1)
    const moved = composeFrame(p, anim.id, 1, 1)
    // the image runs from y 24 (tip) to y 63 (feet); the elbow sits at y 44
    expect(rowWidth(moved, 62)).toBe(6) // the upper arm never moved in depth
    expect(rowWidth(moved, 58)).toBe(6)
    expect(rowWidth(moved, 30)).toBeGreaterThan(6) // the forearm did
    const b = opaqueBounds(moved, 64, 64)!
    expect(b.y).toBeLessThan(24) // and reaches higher than the image it was drawn from
  })

  it('leaves the whole part alone when the camera distance is off', () => {
    const { p, anim } = armProject(0)
    expect(Array.from(composeFrame(p, anim.id, 1, 1))).toEqual(Array.from(composeFrame(p, anim.id, 0, 1)))
  })
})

/** A cube on a bone lifted clear of the ground, animated towards the camera. */
function cubeProject(depthScale: number) {
  const p = createProject({ canvasSize: 64, viewCount: 1, mirror: false, starter: false })
  p.views.depthScale = depthScale
  const bone = addBone(p, { name: 'chest', length: 10, rest: { position: { u: 26 } } })
  const part = addSolidsPart(p, bone.id)
  addPrimitive(p, part.id, 'cube', RED, 16)
  const anim = addAnimation(p, { frameCount: 2 })
  const track = ensureBoneTrack(anim, bone.id).translate
  setKey(track, 0, { r: 0, u: 0, f: 0 })
  setKey(track, 1, { r: 0, u: 0, f: 14 })
  return { p, anim }
}

describe('solids in depth', () => {
  it('draws the rest pose exactly as a flat project does', () => {
    const flat = cubeProject(0)
    const deep = cubeProject(0.5)
    expect(Array.from(composeFrame(deep.p, deep.anim.id, 0, 1))).toEqual(Array.from(composeFrame(flat.p, flat.anim.id, 0, 1)))
  })

  it('grows as the volume comes towards the camera', () => {
    const flat = cubeProject(0)
    const deep = cubeProject(0.5)
    const same = bounds(composeFrame(flat.p, flat.anim.id, 1, 1))
    const rest = bounds(composeFrame(flat.p, flat.anim.id, 0, 1))
    expect(same.w).toBe(rest.w) // orthographic on its own: moving in depth changed nothing
    const near = bounds(composeFrame(deep.p, deep.anim.id, 1, 1))
    expect(near.w).toBeGreaterThan(same.w)
    expect(near.h).toBeGreaterThan(same.h)
  })
})
