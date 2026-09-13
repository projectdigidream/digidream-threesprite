import { describe, it, expect } from 'vitest'
import { setKey } from '../../domain/animation'
import { createImage } from '../../domain/image'
import { activePalette, DEFAULT_PALETTE } from '../../domain/palette'
import {
  addAnimation, addBone, addPalette, addPart, addVariant, boneOrder, createProject, duplicatePalette, ensureBoneTrack, ensurePartTrack,
  normalizeSpriteName, removeBone, removePalette, removePart, removeVariant, renamePalette, reparentBone, repairPalettes, setActivePalette,
  setFrameCount, setPartImage, setViews, validate,
} from '../../domain/project'

describe('createProject', () => {
  it('builds a valid starter project', () => {
    const p = createProject({ name: 'Hero', spriteName: 'hero', canvasSize: 48, viewCount: 6 })
    expect(validate(p)).toEqual([])
    expect(p.spriteName).toBe('HERO')
    expect(p.canvas.size).toBe(48)
    expect(p.views).toEqual({ count: 6, mirror: true, elevationDeg: 0 })
    expect(p.skeleton.rootOrder).toHaveLength(1)
    expect(p.partOrder).toHaveLength(1)
    expect(p.animationOrder).toHaveLength(1)
  })

  it('clamps and normalises inputs', () => {
    const p = createProject({ canvasSize: 3, viewCount: 999, spriteName: 'a-b' })
    expect(p.canvas.size).toBe(8)
    expect(p.views.count).toBe(64)
    expect(p.spriteName).toBe('ABSP')
    expect(normalizeSpriteName('too long name')).toBe('TOOL')
  })
})

describe('bones', () => {
  it('removeBone reparents children and parts, and drops tracks', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { name: 'root' })
    const mid = addBone(p, { name: 'mid', parentId: root.id })
    const leaf = addBone(p, { name: 'leaf', parentId: mid.id })
    const part = addPart(p, { boneId: mid.id })
    const anim = addAnimation(p)
    setKey(ensureBoneTrack(anim, mid.id).rotation, 0, { r: 0, u: 0, f: 10 })
    removeBone(p, mid.id)
    expect(p.skeleton.bones[mid.id]).toBeUndefined()
    expect(p.skeleton.bones[leaf.id].parentId).toBe(root.id)
    expect(p.skeleton.bones[root.id].children).toEqual([leaf.id])
    expect(p.parts[part.id].boneId).toBe(root.id)
    expect(anim.boneTracks[mid.id]).toBeUndefined()
    expect(validate(p)).toEqual([])
  })

  it('removing a root promotes its children to roots', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const a = addBone(p, { name: 'a' })
    const b = addBone(p, { name: 'b', parentId: a.id })
    addBone(p, { name: 'c' })
    removeBone(p, a.id)
    expect(p.skeleton.rootOrder[0]).toBe(b.id)
    expect(p.skeleton.bones[b.id].parentId).toBeNull()
    expect(validate(p)).toEqual([])
  })

  it('refuses to remove the last bone and to create cycles', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const a = addBone(p)
    expect(() => removeBone(p, a.id)).toThrow()
    const b = addBone(p, { parentId: a.id })
    expect(() => reparentBone(p, a.id, b.id)).toThrow()
    expect(() => reparentBone(p, a.id, a.id)).toThrow()
    reparentBone(p, b.id, null)
    expect(p.skeleton.rootOrder).toEqual([a.id, b.id])
    expect(boneOrder(p)).toEqual([a.id, b.id])
    expect(validate(p)).toEqual([])
  })
})

describe('parts, variants, views', () => {
  it('variants and images', () => {
    const p = createProject({ canvasSize: 16 })
    const partId = p.partOrder[0]
    const v2 = addVariant(p, partId, 'open')
    setPartImage(p, partId, v2.id, 2, createImage(4, 4))
    expect(validate(p)).toEqual([])
    const anim = p.animations[p.animationOrder[0]]
    setKey(ensurePartTrack(anim, partId).variant, 1, v2.id, 'step')
    removeVariant(p, partId, v2.id)
    expect(anim.partTracks[partId].variant).toHaveLength(0)
    expect(() => removeVariant(p, partId, p.parts[partId].defaultVariant)).toThrow()
    removePart(p, partId)
    expect(p.partOrder).toHaveLength(0)
    expect(anim.partTracks[partId]).toBeUndefined()
  })

  it('setViews drops images of views that stop being authored', () => {
    const p = createProject({ canvasSize: 16, viewCount: 8, mirror: false })
    const partId = p.partOrder[0]
    const vid = p.parts[partId].defaultVariant
    for (let k = 1; k <= 8; k++) setPartImage(p, partId, vid, k, createImage(2, 2))
    const warnings = setViews(p, 8, true)
    expect(warnings).toHaveLength(3)
    expect(Object.keys(p.parts[partId].variants[vid].images).map(Number)).toEqual([1, 2, 3, 4, 5])
    expect(validate(p)).toEqual([])
  })

  it('validate flags a non-authored image and an oversize image', () => {
    const p = createProject({ canvasSize: 16, viewCount: 4, mirror: true })
    const partId = p.partOrder[0]
    const vid = p.parts[partId].defaultVariant
    p.parts[partId].variants[vid].images[4] = createImage(2, 2)
    p.parts[partId].variants[vid].images[1] = createImage(20, 2)
    const errs = validate(p)
    expect(errs.some(e => e.includes('non-authored view 4'))).toBe(true)
    expect(errs.some(e => e.includes('larger than the canvas'))).toBe(true)
  })
})

describe('animations', () => {
  it('shrinking the frame count drops out-of-range keys', () => {
    const p = createProject({ canvasSize: 16 })
    const anim = p.animations[p.animationOrder[0]]
    const boneId = p.skeleton.rootOrder[0]
    const t = ensureBoneTrack(anim, boneId)
    setKey(t.rotation, 0, { r: 0, u: 0, f: 0 }); setKey(t.rotation, 3, { r: 0, u: 0, f: 90 })
    setFrameCount(p, anim.id, 2)
    expect(t.rotation).toHaveLength(1)
    expect(validate(p)).toEqual([])
  })
})

describe('palettes', () => {
  it('new projects start with the default preset as the active palette', () => {
    const p = createProject()
    expect(p.paletteOrder).toHaveLength(1)
    expect(activePalette(p).name).toBe('DawnBringer 16')
    expect(activePalette(p).colors).toEqual(DEFAULT_PALETTE)
    expect(activePalette(p).colors).not.toBe(DEFAULT_PALETTE)
    expect(validate(p)).toEqual([])
  })

  it('add / activate / duplicate / rename / remove keep the list consistent', () => {
    const p = createProject()
    const first = p.activePaletteId
    const a = addPalette(p, 'DawnBringer 16', [[0, 0, 0, 255]])
    expect(a.name).toBe('DawnBringer 16 2')
    expect(p.paletteOrder).toEqual([first, a.id])
    expect(p.activePaletteId).toBe(first)
    expect(setActivePalette(p, a.id)).toBe(true)
    expect(setActivePalette(p, 'nope')).toBe(false)
    expect(p.activePaletteId).toBe(a.id)

    const d = duplicatePalette(p, a.id)!
    expect(d.name).toBe('DawnBringer 16 2 copy')
    expect(d.colors).toEqual(a.colors)
    expect(d.colors).not.toBe(a.colors)
    expect(p.paletteOrder).toEqual([first, a.id, d.id])
    expect(duplicatePalette(p, 'nope')).toBeNull()

    renamePalette(p, d.id, '  Skin  ')
    expect(d.name).toBe('Skin')
    renamePalette(p, d.id, 'DawnBringer 16')
    expect(d.name).toBe('DawnBringer 16 3')
    renamePalette(p, d.id, '   ')
    expect(d.name).toBe('DawnBringer 16 3')

    expect(removePalette(p, a.id)).toBe(true)
    expect(p.activePaletteId).toBe(d.id)
    expect(removePalette(p, d.id)).toBe(true)
    expect(p.activePaletteId).toBe(first)
    expect(removePalette(p, first)).toBe(false)
    expect(p.paletteOrder).toEqual([first])
    expect(validate(p)).toEqual([])
  })

  it('validate reports broken palette state and repairPalettes fixes it', () => {
    const p = createProject()
    p.activePaletteId = 'missing'
    expect(validate(p)).toContain('activePaletteId missing is not a palette')
    repairPalettes(p)
    expect(validate(p)).toEqual([])
    expect(p.activePaletteId).toBe(p.paletteOrder[0])

    const q = createProject()
    q.palettes = {}
    q.paletteOrder = []
    expect(validate(q)).toContain('project has no palette')
    repairPalettes(q)
    expect(validate(q)).toEqual([])
    expect(activePalette(q).colors).toEqual(DEFAULT_PALETTE)

    const r = createProject()
    ;(activePalette(r).colors as unknown[]).push([1, 2, 3], 'red')
    r.paletteOrder.push('ghost')
    expect(validate(r).some(e => /invalid colour/.test(e))).toBe(true)
    expect(validate(r).some(e => /permutation/.test(e))).toBe(true)
    repairPalettes(r)
    expect(validate(r)).toEqual([])
    expect(activePalette(r).colors).toHaveLength(16)
  })
})
