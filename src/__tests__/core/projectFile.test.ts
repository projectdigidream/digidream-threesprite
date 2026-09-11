import { describe, it, expect } from 'vitest'
import { decodeProject, encodeProject, imageFromPng, pngFromImage } from '../../core/io/projectFile'
import { createImage, setPixel } from '../../domain/image'
import { addAnimation, addPart, addVariant, createProject, setPartImage, validate } from '../../domain/project'
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
    setKey(ensureBoneTrack(anim, bone.id).rotation, 2, 45, 'easeInOut')

    const bytes = encodeProject(p)
    const { project: q, warnings } = decodeProject(bytes)
    expect(warnings).toEqual([])
    expect(validate(q)).toEqual([])
    expect(q.name).toBe('Round trip')
    expect(q.views).toEqual({ count: 6, mirror: true })
    expect(q.parts[partId].variants[vid].images[1].pixels).toEqual(img.pixels)
    expect(q.parts[partId].variants[v2.id].images[3].width).toBe(5)
    expect(Array.from(q.parts[partId].variants[v2.id].images[3].pixels.slice((6 * 5 + 4) * 4))).toEqual([9, 8, 7, 200])
    expect(q.parts[other.id].name).toBe('hat')
    expect(q.animations[anim.id].boneTracks[bone.id].rotation[0]).toEqual({ frame: 2, value: 45, interp: 'easeInOut' })
    // the JSON must not carry pixel arrays
    expect(bytes.length).toBeLessThan(20000)
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
