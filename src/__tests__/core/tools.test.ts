import { describe, it, expect } from 'vitest'
import { fillAt, plotBrush, strokeSegment } from '../../core/tools/brush'
import { centeredPan, fitZoom, nextZoom, snapZoom, zoomAbout, ZOOM_LEVELS } from '../../core/tools/zoom'
import { createImage } from '../../domain/image'
import { ascii, RED, GREEN, toAscii } from '../fixtures/pixels'

describe('brush', () => {
  it('plots a square brush and mirrors it', () => {
    const img = createImage(6, 3)
    plotBrush(img, 1, 1, RED, 1, true)
    expect(toAscii(img.pixels, 6, 3)).toEqual(['......', '.X..X.', '......'])
    const img2 = createImage(6, 4)
    plotBrush(img2, 1, 1, RED, 2, false)
    expect(toAscii(img2.pixels, 6, 4)).toEqual(['......', '.XX...', '.XX...', '......'])
    const img3 = createImage(5, 5)
    plotBrush(img3, 2, 2, RED, 3, false)
    expect(toAscii(img3.pixels, 5, 5)).toEqual(['.....', '.XXX.', '.XXX.', '.XXX.', '.....'])
  })

  it('strokes lines between samples and clips off-image points', () => {
    const img = createImage(4, 4)
    strokeSegment(img, -2, 0, 3, 0, RED)
    expect(toAscii(img.pixels, 4, 4)[0]).toBe('XXXX')
  })

  it('fills with mirroring', () => {
    const img = ascii(['X.X.X', 'X.X.X'])
    fillAt(img, 1, 0, GREEN, true)
    expect(toAscii(img.pixels, 5, 2)).toEqual(['XGXGX', 'XGXGX'])
  })
})

describe('zoom', () => {
  it('snaps to levels and steps through them', () => {
    expect(snapZoom(6.5)).toBe(6)
    expect(snapZoom(7)).toBe(8) // nearest in log space
    expect(snapZoom(7.5)).toBe(8)
    expect(nextZoom(8, 1)).toBe(12)
    expect(nextZoom(8, -1)).toBe(6)
    expect(nextZoom(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], 1)).toBe(64)
    expect(nextZoom(1, -1)).toBe(1)
  })
  it('fit picks the largest level that fits and centres the canvas', () => {
    expect(fitZoom(64, 800, 600)).toBe(8)
    expect(fitZoom(256, 300, 300)).toBe(1)
    expect(centeredPan(64, 8, 800, 600)).toEqual({ x: 144, y: 44 })
  })
  it('zoomAbout keeps the anchor fixed', () => {
    const pan = { x: 100, y: 50 }
    const anchor = { x: 300, y: 200 }
    const p2 = zoomAbout(4, 8, pan, anchor.x, anchor.y)
    // canvas point under the anchor before: (300-100)/4 = 50; after: (300 - p2.x)/8 must be 50
    expect((anchor.x - p2.x) / 8).toBeCloseTo(50)
    expect((anchor.y - p2.y) / 8).toBeCloseTo((anchor.y - pan.y) / 4)
  })
})
