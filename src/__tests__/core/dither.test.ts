import { describe, it, expect } from 'vitest'
import { clampDensity, clampOffset, densityPercent, ditherAllows, ditherMask, ditherSegment, DITHER_MAX, DITHER_SIZE } from '../../core/tools/dither'
import { strokeSegment } from '../../core/tools/brush'
import { createImage, getPixel } from '../../domain/image'
import { RED } from '../fixtures/pixels'

/** How many pixels of a w×h area the pattern turns on. */
function coverage(w: number, h: number, density: number, offset = 0): number {
  let n = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ditherAllows(x, y, density, offset)) n++
  return n
}

describe('the dither pattern', () => {
  it('covers the fraction of pixels the density asks for', () => {
    // over a whole 4×4 tile each density step turns on exactly one more pixel
    for (let d = 0; d <= DITHER_MAX; d++) {
      expect(coverage(DITHER_SIZE, DITHER_SIZE, d), `density ${d}`).toBe(d)
    }
  })

  it('paints nothing at 0 and everything at full', () => {
    expect(coverage(16, 16, 0)).toBe(0)
    expect(coverage(16, 16, DITHER_MAX)).toBe(256)
    expect(coverage(16, 16, DITHER_MAX + 5)).toBe(256)
    expect(coverage(16, 16, -3)).toBe(0)
  })

  it('is a checkerboard at half', () => {
    const half = DITHER_MAX / 2
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(ditherAllows(x, y, half), `${x},${y}`).toBe((x + y) % 2 === 0)
      }
    }
  })

  it('tiles, so the pattern does not drift across the image', () => {
    for (const d of [3, 8, 13]) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          expect(ditherAllows(x, y, d)).toBe(ditherAllows(x + DITHER_SIZE * 7, y + DITHER_SIZE * 3, d))
        }
      }
    }
  })

  it('grows monotonically: anything on at one density stays on at a higher one', () => {
    for (let d = 0; d < DITHER_MAX; d++) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          if (ditherAllows(x, y, d)) expect(ditherAllows(x, y, d + 1), `${x},${y} at ${d}`).toBe(true)
        }
      }
    }
  })

  it('the offset slides the pattern without changing how much is covered', () => {
    for (let o = 0; o < DITHER_SIZE; o++) {
      expect(coverage(DITHER_SIZE, DITHER_SIZE, 6, o), `offset ${o}`).toBe(6)
    }
    // a checkerboard meshes with itself on an odd offset, which is the point
    expect(ditherAllows(0, 0, 8, 0)).toBe(true)
    expect(ditherAllows(0, 0, 8, 1)).toBe(false)
    expect(ditherAllows(0, 0, 8, 2)).toBe(true)
    expect(ditherAllows(0, 0, 8, 3)).toBe(false)
    // the four offsets give four distinct patterns at a density that is not half
    const shapes = new Set([0, 1, 2, 3].map(o =>
      [0, 1, 2, 3].flatMap(y => [0, 1, 2, 3].map(x => (ditherAllows(x, y, 5, o) ? '#' : '.'))).join('')))
    expect(shapes.size).toBe(4)
    // and offsets wrap
    expect(ditherAllows(2, 3, 5, DITHER_SIZE)).toBe(ditherAllows(2, 3, 5, 0))
    expect(ditherAllows(2, 3, 5, -1)).toBe(ditherAllows(2, 3, 5, DITHER_SIZE - 1))
  })

  it('clamps and reports its settings', () => {
    expect(clampDensity(99)).toBe(DITHER_MAX)
    expect(clampDensity(-4)).toBe(0)
    expect(clampDensity(Number.NaN)).toBe(0)
    expect(clampOffset(5)).toBe(1)
    expect(clampOffset(-1)).toBe(3)
    expect(densityPercent(8)).toBe(50)
    expect(densityPercent(DITHER_MAX)).toBe(100)
    expect(densityPercent(0)).toBe(0)
  })
})

describe('dithered strokes', () => {
  it('leaves the pixels the pattern skips untouched', () => {
    const img = createImage(8, 8)
    ditherSegment(img, 0, 0, 7, 0, RED, 1, false, 8, 0)
    for (let x = 0; x < 8; x++) {
      expect(getPixel(img, x, 0)?.[3], `x ${x}`).toBe(x % 2 === 0 ? 255 : 0)
    }
  })

  it('anchors the pattern to the image, not to the stroke', () => {
    const forward = createImage(8, 8)
    const backward = createImage(8, 8)
    ditherSegment(forward, 1, 2, 6, 2, RED, 1, false, 5, 1)
    ditherSegment(backward, 6, 2, 1, 2, RED, 1, false, 5, 1)
    expect(Array.from(backward.pixels)).toEqual(Array.from(forward.pixels))
  })

  it('a full-density dither draws the same as a plain stroke', () => {
    const dithered = createImage(8, 8)
    const plain = createImage(8, 8)
    ditherSegment(dithered, 0, 0, 7, 7, RED, 2, false, DITHER_MAX, 0)
    strokeSegment(plain, 0, 0, 7, 7, RED, 2, false)
    expect(Array.from(dithered.pixels)).toEqual(Array.from(plain.pixels))
  })

  it('mirrored drawing reads the pattern at each pixel, so it stays coherent', () => {
    const img = createImage(8, 8)
    ditherSegment(img, 1, 1, 1, 1, RED, 1, true, 8, 0)
    // the mirror of x=1 is x=6; both are painted only where the pattern allows
    expect(getPixel(img, 1, 1)?.[3]).toBe(ditherAllows(1, 1, 8) ? 255 : 0)
    expect(getPixel(img, 6, 1)?.[3]).toBe(ditherAllows(6, 1, 8) ? 255 : 0)
  })

  it('exposes the mask the brush takes', () => {
    const mask = ditherMask(4, 2)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) expect(mask(x, y)).toBe(ditherAllows(x, y, 4, 2))
  })
})
