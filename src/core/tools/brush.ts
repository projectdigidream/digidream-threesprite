import { drawLine, floodFill, setPixel } from '../../domain/image'
import type { PartImage, RGBA } from '../../domain/types'

/** Stamp a `size × size` square brush at (x, y), mirrored about the image's vertical centre when asked. */
export function plotBrush(img: PartImage, x: number, y: number, color: RGBA, size = 1, mirror = false): void {
  const off = Math.floor((size - 1) / 2)
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const px = x - off + dx
      const py = y - off + dy
      setPixel(img, px, py, color)
      if (mirror) setPixel(img, img.width - 1 - px, py, color)
    }
  }
}

/** Brush stroke segment between two pointer samples (inclusive). */
export function strokeSegment(img: PartImage, x0: number, y0: number, x1: number, y1: number, color: RGBA, size = 1, mirror = false): void {
  drawLine(img, x0, y0, x1, y1, color, (x, y) => plotBrush(img, x, y, color, size, mirror))
}

/** Flood fill at (x, y); with mirroring also fills the mirrored point. Returns pixels changed. */
export function fillAt(img: PartImage, x: number, y: number, color: RGBA, mirror = false): number {
  let n = floodFill(img, x, y, color)
  if (mirror) n += floodFill(img, img.width - 1 - x, y, color)
  return n
}

export const MAX_BRUSH = 4
