import { describe, it, expect } from 'vitest'
import { doomFrameLetter, doomRotationChar, planExport, slug } from '../../core/export/plan'
import { DEFAULT_OPTIONS } from '../../core/export/types'
import { buildManifest, collectFrames, decodeBundle, encodeBundle } from '../../core/io/exportBundle'
import { addAnimation, createProject, setViews } from '../../domain/project'

describe('doom naming', () => {
  it('rotation characters for 1, 8 and 16 views', () => {
    expect(doomRotationChar(1, 1)).toBe('0')
    expect(doomRotationChar(8, 3)).toBe('3')
    expect(doomRotationChar(16, 9)).toBe('9')
    expect(doomRotationChar(16, 10)).toBe('A')
    expect(doomRotationChar(16, 16)).toBe('G')
    expect(() => doomRotationChar(6, 1)).toThrow()
    expect(doomFrameLetter(0)).toBe('A')
    expect(doomFrameLetter(25)).toBe('Z')
    expect(() => doomFrameLetter(26)).toThrow()
    expect(slug('walk cycle/2')).toBe('walk_cycle_2')
  })
})

describe('planExport', () => {
  it('names doom files across animations and refuses unsupported counts', () => {
    const p = createProject({ canvasSize: 8, viewCount: 8, spriteName: 'HERO' })
    addAnimation(p, { name: 'die', frameCount: 2 })
    const plan = planExport(p, { format: 'doom', animIds: p.animationOrder, options: DEFAULT_OPTIONS })
    expect(plan.errors).toEqual([])
    expect(plan.files).toHaveLength(6 * 8)
    expect(plan.files[0]).toEqual({ name: 'HEROA1.png', frameIndex: 0 })
    expect(plan.files[8].name).toBe('HEROB1.png')
    expect(plan.files[4 * 8].name).toBe('HEROE1.png')
    expect(plan.files[4 * 8].frameIndex).toBe(32)

    setViews(p, 6, true)
    const bad = planExport(p, { format: 'doom', animIds: p.animationOrder, options: DEFAULT_OPTIONS })
    expect(bad.errors.length).toBeGreaterThan(0)
    const front = planExport(p, { format: 'doom', animIds: p.animationOrder, options: { ...DEFAULT_OPTIONS, doomFrontOnly: true } })
    expect(front.errors).toEqual([])
    expect(front.files).toHaveLength(6)
    expect(front.files[1]).toEqual({ name: 'HEROB0.png', frameIndex: 6 })
    expect(front.warnings.length).toBe(1)
  })

  it('caps doom frames at 26 and names pngs/atlas/gif', () => {
    const p = createProject({ canvasSize: 8, viewCount: 4, spriteName: 'ABCD' })
    addAnimation(p, { name: 'long', frameCount: 23 })
    expect(planExport(p, { format: 'doom', animIds: p.animationOrder, options: DEFAULT_OPTIONS }).errors.some(e => e.includes('26'))).toBe(true)
    const pngs = planExport(p, { format: 'pngs', animIds: [p.animationOrder[0]], options: DEFAULT_OPTIONS })
    expect(pngs.files[5].name).toBe('ABCD/idle/001_v02.png')
    const atlas = planExport(p, { format: 'atlas', animIds: p.animationOrder, options: DEFAULT_OPTIONS })
    expect(atlas.files.map(f => f.name)).toEqual(['ABCD.png', 'ABCD.json'])
    const gif = planExport(p, { format: 'gif', animIds: [p.animationOrder[0]], options: DEFAULT_OPTIONS })
    expect(gif.files.map(f => f.name)).toEqual(['ABCD_idle_v01.gif', 'ABCD_idle_v02.gif', 'ABCD_idle_v03.gif', 'ABCD_idle_v04.gif', 'ABCD_turntable.gif'])
    expect(gif.warnings.length).toBe(1) // 8 fps is not a divisor of 100
    expect(planExport(p, { format: 'pngs', animIds: [], options: DEFAULT_OPTIONS }).errors.length).toBe(1)
  })
})

describe('bundle', () => {
  it('encodes frames in anim → frame → view order and decodes back', () => {
    const p = createProject({ canvasSize: 8, viewCount: 4, mirror: true })
    const collected = collectFrames(p, p.animationOrder)
    expect(collected.frames).toHaveLength(4 * 4)
    expect(collected.frames[5]).toEqual({ anim: 0, frame: 1, view: 2 })
    const manifest = buildManifest(p, { format: 'pngs', animIds: p.animationOrder, options: DEFAULT_OPTIONS }, { kind: 'dir', path: '/tmp/x' }, collected)
    const bytes = encodeBundle(manifest, collected.buffers, 8)
    expect(bytes.length).toBe(4 + new TextEncoder().encode(JSON.stringify(manifest)).length + 16 * 8 * 8 * 4)
    const back = decodeBundle(bytes)
    expect(back.manifest.sprite).toBe(p.spriteName)
    expect(back.manifest.views).toEqual({ count: 4, mirror: true })
    expect(back.buffers).toHaveLength(16)
    expect(Array.from(back.buffers[3])).toEqual(Array.from(collected.buffers[3]))
  })
})
