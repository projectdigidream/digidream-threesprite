import { describe, it, expect } from 'vitest'
import { authoredViews, clampViewCount, isDerived, mirrorOf, mod1, sourceView, viewAngleDeg, viewIndex, viewLabel } from '../../domain/views'
import { screenFacingX } from '../../core/preview/rotation'

describe('viewIndex', () => {
  it('cardinal points for N=8 follow the Doom convention', () => {
    const facing = 0.3
    expect(viewIndex(8, facing, facing)).toBe(1) // camera in front
    expect(viewIndex(8, facing, facing + 0.25)).toBe(3) // camera at the character's left
    expect(viewIndex(8, facing, facing + 0.5)).toBe(5) // behind
    expect(viewIndex(8, facing, facing + 0.75)).toBe(7) // right
    expect(viewIndex(8, facing, facing - 0.125)).toBe(8)
  })

  it('each view owns the arc centred on its angle', () => {
    const half = 1 / 16
    expect(viewIndex(8, 0, half - 1e-9)).toBe(1)
    expect(viewIndex(8, 0, half + 1e-9)).toBe(2)
    expect(viewIndex(8, 0, -half + 1e-9)).toBe(1)
    expect(viewIndex(8, 0, -half - 1e-9)).toBe(8)
  })

  it('N=1 always returns 1; N=4/6 wrap correctly', () => {
    for (let i = 0; i < 20; i++) expect(viewIndex(1, Math.random(), Math.random())).toBe(1)
    expect(viewIndex(4, 0, 0.5)).toBe(3)
    expect(viewIndex(6, 0, 1 / 6)).toBe(2)
    expect(viewIndex(6, 0, 5 / 6)).toBe(6)
    expect(viewIndex(6, 0, 0.999)).toBe(1)
  })

  it('property: the chosen view is the nearest nominal angle to the true relative bearing', () => {
    let seed = 12345
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    for (let t = 0; t < 5000; t++) {
      const N = 1 + Math.floor(rnd() * 64)
      const facing = rnd() * 4 - 2
      const bearing = rnd() * 4 - 2
      const k = viewIndex(N, facing, bearing)
      expect(k).toBeGreaterThanOrEqual(1)
      expect(k).toBeLessThanOrEqual(N)
      const rel = mod1(bearing - facing)
      const nominal = (k - 1) / N
      let diff = Math.abs(rel - nominal)
      diff = Math.min(diff, 1 - diff)
      expect(diff).toBeLessThanOrEqual(0.5 / N + 1e-9)
      // The picture's screen-facing direction agrees with the true one to within the view's half-arc.
      const trueX = screenFacingX(rel)
      const shownX = screenFacingX(nominal)
      expect(Math.abs(trueX - shownX)).toBeLessThanOrEqual(2 * Math.PI * (0.5 / N) + 1e-9)
    }
  })
})

describe('mirrorOf / authoredViews', () => {
  it('N=8: 1 and 5 are self-mirrors, 2↔8, 3↔7, 4↔6', () => {
    expect(mirrorOf(8, 1)).toBe(1)
    expect(mirrorOf(8, 5)).toBe(5)
    expect(mirrorOf(8, 2)).toBe(8)
    expect(mirrorOf(8, 8)).toBe(2)
    expect(mirrorOf(8, 3)).toBe(7)
    expect(mirrorOf(8, 4)).toBe(6)
  })

  it('odd N has only view 1 as its own mirror', () => {
    expect(mirrorOf(7, 1)).toBe(1)
    expect(mirrorOf(7, 2)).toBe(7)
    expect(mirrorOf(7, 4)).toBe(5)
    expect(mirrorOf(7, 5)).toBe(4)
  })

  it('mirrorOf is an involution for every N', () => {
    for (let N = 1; N <= 64; N++) for (let k = 1; k <= N; k++) expect(mirrorOf(N, mirrorOf(N, k))).toBe(k)
  })

  it('authored views cover the half circle and every derived view maps to an authored one', () => {
    expect(authoredViews(8, true)).toEqual([1, 2, 3, 4, 5])
    expect(authoredViews(8, false)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(authoredViews(6, true)).toEqual([1, 2, 3, 4])
    expect(authoredViews(7, true)).toEqual([1, 2, 3, 4])
    expect(authoredViews(1, true)).toEqual([1])
    for (let N = 1; N <= 64; N++) {
      const authored = new Set(authoredViews(N, true))
      for (let k = 1; k <= N; k++) {
        expect(authored.has(sourceView(N, true, k))).toBe(true)
        expect(isDerived(N, true, k)).toBe(!authored.has(k))
      }
    }
  })
})

describe('labels and clamping', () => {
  it('names the cardinal views', () => {
    expect(viewLabel(8, 1)).toBe('Front')
    expect(viewLabel(8, 3)).toBe('Left side')
    expect(viewLabel(8, 5)).toBe('Back')
    expect(viewLabel(8, 7)).toBe('Right side')
    expect(viewLabel(8, 2)).toBe('Front-left 45°')
    expect(viewLabel(8, 8)).toBe('Front-right 315°')
    expect(viewAngleDeg(6, 4)).toBe(180)
  })

  it('clamps the view count to 1..64', () => {
    expect(clampViewCount(0)).toBe(1)
    expect(clampViewCount(100)).toBe(64)
    expect(clampViewCount(6.4)).toBe(6)
    expect(clampViewCount(NaN)).toBe(8)
  })
})
