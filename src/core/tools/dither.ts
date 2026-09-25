/**
 * Ordered dithering.
 *
 * A 4×4 Bayer matrix holds the sixteen thresholds of the classic pixel-art
 * pattern: at density 8 you get a checkerboard, below it a thinning stipple,
 * above it a thickening one. The threshold is read at the pixel's own place in
 * the image, not along the stroke, so the pattern stays put however you drag
 * and two strokes over the same area land on the same pixels.
 */
import type { PartImage, RGBA } from '../../domain/types'
import { drawLine } from '../../domain/image'
import { plotBrush } from './brush'

/** Recursive Bayer ordering; each value is the density at which that pixel turns on. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export const DITHER_SIZE = 4
/** Density runs 0 (nothing) to 16 (solid); 8 is a checkerboard. */
export const DITHER_MAX = 16
/** An offset slides the pattern sideways, so neighbouring areas mesh instead of lining up. */
export const DITHER_OFFSETS = DITHER_SIZE

export const clampDensity = (n: number): number => Math.min(DITHER_MAX, Math.max(0, Math.round(n) || 0))
export const clampOffset = (n: number): number => (((Math.round(n) || 0) % DITHER_OFFSETS) + DITHER_OFFSETS) % DITHER_OFFSETS

const wrap = (n: number): number => ((n % DITHER_SIZE) + DITHER_SIZE) % DITHER_SIZE

/** Whether the pixel at (x, y) is part of the pattern. */
export function ditherAllows(x: number, y: number, density: number, offset = 0): boolean {
  if (density >= DITHER_MAX) return true
  if (density <= 0) return false
  // sideways only: shifting both axes would leave a checkerboard's parity
  // untouched, which is the one case an offset most needs to change
  return BAYER4[wrap(y)][wrap(x + clampOffset(offset))] < density
}

/** The predicate `plotBrush` and `strokeSegment` take, bound to a density and offset. */
export function ditherMask(density: number, offset = 0): (x: number, y: number) => boolean {
  return (x, y) => ditherAllows(x, y, density, offset)
}

/** One stroke segment, painted through the pattern. */
export function ditherSegment(
  img: PartImage,
  x0: number, y0: number, x1: number, y1: number,
  color: RGBA,
  size = 1,
  mirror = false,
  density = DITHER_MAX / 2,
  offset = 0,
): void {
  const mask = ditherMask(density, offset)
  drawLine(img, x0, y0, x1, y1, color, (x, y) => plotBrush(img, x, y, color, size, mirror, mask))
}

/** Density as a percentage, for a readout. */
export const densityPercent = (density: number): number => Math.round((clampDensity(density) / DITHER_MAX) * 100)
