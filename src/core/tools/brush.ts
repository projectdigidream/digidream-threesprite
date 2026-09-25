import { drawLine, floodFill, setPixel } from '../../domain/image'
import type { PartImage, RGBA } from '../../domain/types'

/** Decides, per pixel, whether the brush leaves a mark there. The dither tool supplies one. */
export type PixelMask = (x: number, y: number) => boolean

/**
 * Stamp a `size × size` square brush at (x, y), mirrored about the image's
 * vertical centre when asked. A mask is asked about each pixel in image
 * coordinates, the mirrored one included, so a pattern stays coherent across
 * the whole image rather than following the stroke.
 */
export function plotBrush(img: PartImage, x: number, y: number, color: RGBA, size = 1, mirror = false, mask?: PixelMask): void {
  const off = Math.floor((size - 1) / 2)
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x - off + dx
      const py = y - off + dy
      if (!mask || mask(px, py)) setPixel(img, px, py, color)
      if (mirror) {
        const mx = img.width - 1 - px
        if (!mask || mask(mx, py)) setPixel(img, mx, py, color)
      }
    }
  }
}

/** Brush stroke segment between two pointer samples (inclusive). */
export function strokeSegment(img: PartImage, x0: number, y0: number, x1: number, y1: number, color: RGBA, size = 1, mirror = false, mask?: PixelMask): void {
  drawLine(img, x0, y0, x1, y1, color, (x, y) => plotBrush(img, x, y, color, size, mirror, mask))
}

/** Flood fill at (x, y); with mirroring also fills the mirrored point. Returns pixels changed. */
export function fillAt(img: PartImage, x: number, y: number, color: RGBA, mirror = false): number {
  let n = floodFill(img, x, y, color)
  if (mirror) n += floodFill(img, img.width - 1 - x, y, color)
  return n
}

export const MAX_BRUSH = 4
