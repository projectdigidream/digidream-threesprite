import { describe, it, expect } from 'vitest'
import { blitCopy, createImage, cropImage, distinctColors, drawLine, flipXImage, floodFill, getPixel, isBlank, opaqueBounds, setPixel } from '../../domain/image'
import { ascii, BLUE, GREEN, L_ROWS, RED, toAscii } from '../fixtures/pixels'

describe('image', () => {
  it('flipX mirrors horizontally', () => {
    const img = ascii(L_ROWS)
    expect(toAscii(flipXImage(img).pixels, 3, 3)).toEqual(['..X', '..X', 'XXX'])
  })

  it('floodFill is 4-connected and matches exact colour', () => {
    const img = ascii(['X.X', '...', 'X.X'])
    const n = floodFill(img, 1, 1, GREEN)
    expect(n).toBe(5)
    expect(toAscii(img.pixels, 3, 3)).toEqual(['XGX', 'GGG', 'XGX'])
    expect(floodFill(img, 0, 0, RED)).toBe(0) // same colour: no-op
    expect(floodFill(img, 0, 0, BLUE)).toBe(1)
  })

  it('drawLine is a Bresenham line including both ends', () => {
    const img = createImage(5, 5)
    drawLine(img, 0, 0, 4, 2, RED)
    expect(toAscii(img.pixels, 5, 5)).toEqual(['X....', '.XX..', '...XX', '.....', '.....'])
  })

  it('opaqueBounds, isBlank, crop and blitCopy', () => {
    const img = createImage(6, 6)
    expect(isBlank(img)).toBe(true)
    expect(opaqueBounds(img.pixels, 6, 6)).toBeNull()
    setPixel(img, 2, 1, RED)
    setPixel(img, 4, 3, BLUE)
    expect(opaqueBounds(img.pixels, 6, 6)).toEqual({ x: 2, y: 1, w: 3, h: 3 })
    const crop = cropImage(img, { x: 2, y: 1, w: 3, h: 3 })
    expect(toAscii(crop.pixels, 3, 3)).toEqual(['X..', '...', '..B'])
    const dst = createImage(4, 4)
    blitCopy(dst, crop, -1, 2)
    expect(getPixel(dst, 1, 4)).toBeUndefined()
    expect(toAscii(dst.pixels, 4, 4)).toEqual(['....', '....', '....', '....'])
    blitCopy(dst, crop, 1, 1)
    expect(toAscii(dst.pixels, 4, 4)).toEqual(['....', '.X..', '....', '...B'])
  })

  it('distinctColors ignores transparent pixels', () => {
    const img = ascii(['XG.', 'X..'])
    expect(distinctColors(img.pixels).size).toBe(2)
  })
})
