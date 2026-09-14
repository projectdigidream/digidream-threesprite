import { describe, it, expect } from 'vitest'
import {
  copyKeys, deleteRowKeys, ensureBoneTrack, ensurePartTrack, frameAt, getKey, lerpNumber, moveKey, moveRowKeys,
  pasteKeys, pastedRefs, removeKey, rowKeyFrames, sampleTrack, setKey,
} from '../../domain/animation'
import { addAnimation, addBone, addPart, createProject } from '../../domain/project'
import type { Key, Vec3 } from '../../domain/types'

describe('frameAt', () => {
  it('holds frame 0 at fps 0 or a single frame', () => {
    expect(frameAt({ fps: 0, frameCount: 4, loop: true }, 10)).toBe(0)
    expect(frameAt({ fps: 8, frameCount: 1, loop: true }, 10)).toBe(0)
  })
  it('loops', () => {
    const a = { fps: 4, frameCount: 4, loop: true }
    expect(frameAt(a, 0)).toBe(0)
    expect(frameAt(a, 0.25)).toBe(1)
    expect(frameAt(a, 1.0)).toBe(0)
    expect(frameAt(a, 1.75)).toBe(3)
  })
  it('clamps when played once', () => {
    const a = { fps: 4, frameCount: 4, loop: false }
    expect(frameAt(a, 5)).toBe(3)
  })
})

describe('sampleTrack', () => {
  const keys: Key<number>[] = [
    { frame: 2, value: 10, interp: 'linear' },
    { frame: 6, value: 30, interp: 'step' },
    { frame: 8, value: 50, interp: 'easeInOut' },
    { frame: 12, value: 70, interp: 'linear' },
  ]
  it('returns identity with no keys and clamps outside', () => {
    expect(sampleTrack([], 3, 99, lerpNumber)).toBe(99)
    expect(sampleTrack(keys, 0, 0, lerpNumber)).toBe(10)
    expect(sampleTrack(keys, 100, 0, lerpNumber)).toBe(70)
  })
  it('interpolates linearly, holds on step, eases on easeInOut', () => {
    expect(sampleTrack(keys, 4, 0, lerpNumber)).toBe(20)
    expect(sampleTrack(keys, 7, 0, lerpNumber)).toBe(30) // step holds
    expect(sampleTrack(keys, 10, 0, lerpNumber)).toBe(60) // smoothstep(0.5) = 0.5
    expect(sampleTrack(keys, 9, 0, lerpNumber)).toBeCloseTo(50 + 20 * (0.25 * 0.25 * (3 - 0.5)))
  })
  it('returns exact key values at key frames', () => {
    expect(sampleTrack(keys, 6, 0, lerpNumber)).toBe(30)
    expect(sampleTrack(keys, 8, 0, lerpNumber)).toBe(50)
  })
})

describe('key editing', () => {
  it('setKey keeps keys sorted and replaces in place', () => {
    const keys: Key<number>[] = []
    setKey(keys, 5, 1)
    setKey(keys, 1, 2)
    setKey(keys, 3, 3)
    setKey(keys, 3, 4)
    expect(keys.map(k => [k.frame, k.value])).toEqual([[1, 2], [3, 4], [5, 1]])
  })
  it('moveKey relocates and overwrites', () => {
    const keys: Key<number>[] = []
    setKey(keys, 1, 1); setKey(keys, 4, 4)
    expect(moveKey(keys, 1, 4)).toBe(true)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatchObject({ frame: 4, value: 1 })
    expect(removeKey(keys, 9)).toBe(false)
    expect(removeKey(keys, 4)).toBe(true)
    expect(keys).toHaveLength(0)
  })
})

describe('timeline rows and the key clipboard', () => {
  const build = () => {
    const p = createProject({ canvasSize: 16, starter: false })
    const a = addBone(p, { name: 'a' }).id
    const b = addBone(p, { name: 'b' }).id
    const part = addPart(p, { boneId: a, width: 4, height: 4 }).id
    const anim = addAnimation(p, { name: 'walk', frameCount: 12 })
    const ta = ensureBoneTrack(anim, a)
    setKey(ta.rotation, 1, { r: 0, u: 30, f: 0 }, 'easeInOut')
    setKey(ta.translate, 1, { r: 2, u: 0, f: 0 })
    setKey(ta.rotation, 4, { r: 0, u: 90, f: 0 }, 'step')
    setKey(ensureBoneTrack(anim, b).scale, 4, { r: 2, u: 2, f: 2 })
    setKey(ensurePartTrack(anim, part).visible, 1, false, 'step')
    return { p, anim, a, b, part }
  }

  it('rowKeyFrames unions the row’s tracks; move and delete act on all of them', () => {
    const { anim, a, part } = build()
    expect([...rowKeyFrames(anim, 'bone', a)].sort((x, y) => x - y)).toEqual([1, 4])
    expect([...rowKeyFrames(anim, 'part', part)]).toEqual([1])
    expect(rowKeyFrames(anim, 'bone', 'ghost').size).toBe(0)

    moveRowKeys(anim, 'bone', a, 1, 7)
    expect([...rowKeyFrames(anim, 'bone', a)].sort((x, y) => x - y)).toEqual([4, 7])
    expect(anim.boneTracks[a].translate[0].frame).toBe(7)

    expect(deleteRowKeys(anim, 'bone', a, 7)).toBe(true)
    expect(deleteRowKeys(anim, 'bone', a, 7)).toBe(false)
    expect([...rowKeyFrames(anim, 'bone', a)]).toEqual([4])
  })

  it('copies a diamond with every track under it and pastes it elsewhere', () => {
    const { anim, a } = build()
    const clip = copyKeys(anim, [{ kind: 'bone', id: a, frame: 1 }])!
    expect(clip.diamonds).toBe(1)
    expect(clip.count).toBe(2)          // rotation + translate
    expect(clip.baseFrame).toBe(1)

    expect(pasteKeys(anim, clip, 9)).toBe(2)
    const rot = getKey(anim.boneTracks[a].rotation, 9)!
    expect(rot.value).toEqual({ r: 0, u: 30, f: 0 })
    expect(rot.interp).toBe('easeInOut')       // the copied interpolation comes along
    expect(getKey(anim.boneTracks[a].translate, 9)!.value).toEqual({ r: 2, u: 0, f: 0 })
    expect(getKey(anim.boneTracks[a].rotation, 1)).toBeDefined()  // the source stays
  })

  it('keeps the spacing between several copied frames and rows', () => {
    const { anim, a, b, part } = build()
    const clip = copyKeys(anim, [
      { kind: 'bone', id: a, frame: 4 },
      { kind: 'bone', id: a, frame: 1 },
      { kind: 'bone', id: b, frame: 4 },
      { kind: 'part', id: part, frame: 1 },
    ])!
    expect(clip.diamonds).toBe(4)
    expect(clip.baseFrame).toBe(1)
    expect(pasteKeys(anim, clip, 6)).toBe(clip.count)
    // frame 1 → 6 and frame 4 → 9: the three-frame gap survives.
    expect([...rowKeyFrames(anim, 'bone', a)].sort((x, y) => x - y)).toEqual([1, 4, 6, 9])
    expect([...rowKeyFrames(anim, 'bone', b)].sort((x, y) => x - y)).toEqual([4, 9])
    expect(getKey(anim.partTracks[part].visible, 6)!.value).toBe(false)
    expect(pastedRefs(clip, 6, 12)).toHaveLength(4)
  })

  it('replaces whatever sits at the target frame', () => {
    const { anim, a } = build()
    const clip = copyKeys(anim, [{ kind: 'bone', id: a, frame: 1 }])!
    setKey(anim.boneTracks[a].rotation, 9, { r: 9, u: 9, f: 9 }, 'step')
    pasteKeys(anim, clip, 9)
    const rot = getKey(anim.boneTracks[a].rotation, 9)!
    expect(rot.value).toEqual({ r: 0, u: 30, f: 0 })
    expect(rot.interp).toBe('easeInOut')
    expect(anim.boneTracks[a].rotation.filter(k => k.frame === 9)).toHaveLength(1)
  })

  it('drops keys that land outside the animation and rows that no longer exist', () => {
    const { anim, a, b } = build()
    const clip = copyKeys(anim, [{ kind: 'bone', id: a, frame: 1 }, { kind: 'bone', id: b, frame: 4 }])!
    // pasted at 10, b's key would land at 13 — past the 12-frame end
    expect(pasteKeys(anim, clip, 10)).toBe(2)
    expect([...rowKeyFrames(anim, 'bone', b)]).toEqual([4])
    expect(pastedRefs(clip, 10, 12)).toEqual([{ kind: 'bone', id: a, frame: 10 }])

    // a row the caller rejects is skipped without creating an empty track
    const fresh = addAnimation(build().p, { name: 'other', frameCount: 12 })
    expect(pasteKeys(fresh, clip, 0, kind => kind === 'part')).toBe(0)
    expect(Object.keys(fresh.boneTracks)).toEqual([])
  })

  it('detaches copied values from the document', () => {
    const { anim, a } = build()
    const clip = copyKeys(anim, [{ kind: 'bone', id: a, frame: 1 }])!
    const source = getKey(anim.boneTracks[a].rotation, 1)!
    ;(source.value as Vec3).u = 999
    pasteKeys(anim, clip, 8)
    expect(getKey(anim.boneTracks[a].rotation, 8)!.value).toEqual({ r: 0, u: 30, f: 0 })
    // and pasting twice does not alias the two keys together
    pasteKeys(anim, clip, 10)
    ;(getKey(anim.boneTracks[a].rotation, 10)!.value as Vec3).u = 5
    expect(getKey(anim.boneTracks[a].rotation, 8)!.value).toEqual({ r: 0, u: 30, f: 0 })
  })

  it('returns null when the picked frames hold no keys', () => {
    const { anim, a } = build()
    expect(copyKeys(anim, [])).toBeNull()
    expect(copyKeys(anim, [{ kind: 'bone', id: a, frame: 3 }])).toBeNull()
    expect(copyKeys(anim, [{ kind: 'bone', id: 'ghost', frame: 1 }])).toBeNull()
  })
})
