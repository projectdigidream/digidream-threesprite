import { describe, it, expect } from 'vitest'
import { frameAt, lerpNumber, moveKey, removeKey, sampleTrack, setKey } from '../../domain/animation'
import type { Key } from '../../domain/types'

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
