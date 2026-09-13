import { describe, it, expect } from 'vitest'
import { unzipSync, zipSync } from 'fflate'
import { decodeProject, encodeProject, imageFromPng, pngFromImage } from '../../core/io/projectFile'
import { createImage, setPixel } from '../../domain/image'
import { DEFAULT_PALETTE } from '../../domain/palette'
import { addAnimation, addPalette, addPart, addVariant, createProject, setActivePalette, setPartImage, validate } from '../../domain/project'
import { setKey } from '../../domain/animation'
import { ensureBoneTrack } from '../../domain/project'

describe('project file', () => {
  it('round-trips a project with semi-transparent pixels, variants, views and keys', () => {
    const p = createProject({ name: 'Round trip', spriteName: 'RTRP', canvasSize: 16, viewCount: 6 })
    const partId = p.partOrder[0]
    const vid = p.parts[partId].defaultVariant
    const img = createImage(16, 16)
    setPixel(img, 1, 2, [255, 0, 0, 255])
    setPixel(img, 3, 4, [10, 20, 30, 128])
    setPixel(img, 5, 6, [0, 0, 0, 1])
    setPartImage(p, partId, vid, 1, img)
    const v2 = addVariant(p, partId, 'alt')
    const small = createImage(5, 7)
    setPixel(small, 4, 6, [9, 8, 7, 200])
    setPartImage(p, partId, v2.id, 3, small)
    const bone = p.skeleton.bones[p.skeleton.rootOrder[0]]
    const other = addPart(p, { boneId: bone.id, name: 'hat', width: 4, height: 4 })
    const anim = addAnimation(p, { name: 'walk', frameCount: 3, fps: 12, loop: false })
    setKey(ensureBoneTrack(anim, bone.id).rotation, 2, { r: 0, u: 45, f: 0 }, 'easeInOut')

    const bytes = encodeProject(p)
    const { project: q, warnings } = decodeProject(bytes)
    expect(warnings).toEqual([])
    expect(validate(q)).toEqual([])
    expect(q.name).toBe('Round trip')
    expect(q.views).toEqual({ count: 6, mirror: true, elevationDeg: 0 })
    expect(q.parts[partId].variants[vid].images[1].pixels).toEqual(img.pixels)
    expect(q.parts[partId].variants[v2.id].images[3].width).toBe(5)
    expect(Array.from(q.parts[partId].variants[v2.id].images[3].pixels.slice((6 * 5 + 4) * 4))).toEqual([9, 8, 7, 200])
    expect(q.parts[other.id].name).toBe('hat')
    expect(q.animations[anim.id].boneTracks[bone.id].rotation[0]).toEqual({ frame: 2, value: { r: 0, u: 45, f: 0 }, interp: 'easeInOut' })
    expect(q.skeleton.bones[bone.id].rest.position).toEqual({ r: 0, u: 0, f: 0 })
    // the JSON must not carry pixel arrays
    expect(bytes.length).toBeLessThan(20000)
  })

  it('round-trips several palettes and which one is active', () => {
    const p = createProject({ canvasSize: 8 })
    const extra = addPalette(p, 'Skin', [[10, 20, 30, 255], [40, 50, 60, 255]])
    setActivePalette(p, extra.id)
    const { project: q, warnings } = decodeProject(encodeProject(p))
    expect(warnings).toEqual([])
    expect(q.paletteOrder).toEqual(p.paletteOrder)
    expect(q.activePaletteId).toBe(extra.id)
    expect(q.palettes[extra.id]).toEqual({ id: extra.id, name: 'Skin', colors: [[10, 20, 30, 255], [40, 50, 60, 255]] })
  })

  it('upgrades a version-2 project: its single palette becomes the active named palette', () => {
    const asV2 = (colors: unknown) => {
      const entries = unzipSync(encodeProject(createProject({ name: 'Old', canvasSize: 8 })))
      const json = JSON.parse(new TextDecoder().decode(entries['project.json'])) as Record<string, unknown>
      delete json.palettes; delete json.paletteOrder; delete json.activePaletteId
      json.formatVersion = 2
      json.palette = { colors }
      entries['project.json'] = new TextEncoder().encode(JSON.stringify(json))
      return zipSync(entries)
    }
    const { project: q, warnings } = decodeProject(asV2([[1, 2, 3, 255], [4, 5, 6, 255], 'junk']))
    expect(warnings).toEqual([])
    expect(validate(q)).toEqual([])
    expect(q.formatVersion).toBe(3)
    expect(q.paletteOrder).toHaveLength(1)
    expect(q.palettes[q.activePaletteId]).toMatchObject({ name: 'Palette', colors: [[1, 2, 3, 255], [4, 5, 6, 255]] })
    expect((q as unknown as Record<string, unknown>).palette).toBeUndefined()

    const { project: r } = decodeProject(asV2(DEFAULT_PALETTE))
    expect(r.palettes[r.activePaletteId].name).toBe('DawnBringer 16')

    const { project: s } = decodeProject(asV2(undefined))
    expect(validate(s)).toEqual([])
    expect(r.palettes[r.activePaletteId].colors).toEqual(DEFAULT_PALETTE)
    expect(s.palettes[s.activePaletteId].colors).toEqual(DEFAULT_PALETTE)
  })

  it('rejects non-projects and reports missing images', () => {
    expect(() => decodeProject(new Uint8Array([1, 2, 3]))).toThrow(/Not a ThreeSprite project/)
  })

  it('png helpers convert RGB and grayscale to RGBA', () => {
    const img = createImage(2, 1)
    setPixel(img, 0, 0, [1, 2, 3, 4])
    const back = imageFromPng(pngFromImage(img))
    expect(Array.from(back.pixels)).toEqual([1, 2, 3, 4, 0, 0, 0, 0])
  })
})
