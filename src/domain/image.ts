import type { PartImage, RGBA } from './types'

export const TRANSPARENT: RGBA = [0, 0, 0, 0]

export function createImage(width: number, height: number, fill?: RGBA): PartImage {
  const pixels = new Uint8ClampedArray(width * height * 4)
  if (fill && fill[3] > 0) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = fill[0]
      pixels[i + 1] = fill[1]
      pixels[i + 2] = fill[2]
      pixels[i + 3] = fill[3]
    }
  }
  return { width, height, pixels }
}

export function cloneImage(img: PartImage): PartImage {
  return { width: img.width, height: img.height, pixels: new Uint8ClampedArray(img.pixels) }
}

export function getPixel(img: PartImage, x: number, y: number): RGBA | undefined {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return undefined
  const i = (y * img.width + x) * 4
  const p = img.pixels
  return [p[i], p[i + 1], p[i + 2], p[i + 3]]
}

export function setPixel(img: PartImage, x: number, y: number, c: RGBA): boolean {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false
  const i = (y * img.width + x) * 4
  const p = img.pixels
  p[i] = c[0]
  p[i + 1] = c[1]
  p[i + 2] = c[2]
  p[i + 3] = c[3]
  return true
}

export function colorsEqual(a: RGBA, b: RGBA): boolean {
  // Two fully transparent pixels are the same colour whatever their RGB.
  if (a[3] === 0 && b[3] === 0) return true
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

/** Bresenham line; calls `plot` for each pixel (defaults to setPixel with `c`). */
export function drawLine(
  img: PartImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: RGBA,
  plot: (x: number, y: number) => void = (x, y) => { setPixel(img, x, y, c) },
): void {
  let dx = Math.abs(x1 - x0)
  let dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  for (;;) {
    plot(x, y)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
  void dx; void dy
}

/** 4-connected flood fill of the exact colour under (x, y). Returns pixels changed. */
export function floodFill(img: PartImage, x: number, y: number, c: RGBA): number {
  const target = getPixel(img, x, y)
  if (!target || colorsEqual(target, c)) return 0
  const { width: w, height: h, pixels: p } = img
  const matches = (i: number) =>
    target[3] === 0 ? p[i + 3] === 0 : p[i] === target[0] && p[i + 1] === target[1] && p[i + 2] === target[2] && p[i + 3] === target[3]
  const stack = [y * w + x]
  const seen = new Uint8Array(w * h)
  let n = 0
  while (stack.length) {
    const idx = stack.pop()!
    if (seen[idx]) continue
    seen[idx] = 1
    const i = idx * 4
    if (!matches(i)) continue
    p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = c[3]
    n++
    const px = idx % w
    const py = (idx - px) / w
    if (px > 0) stack.push(idx - 1)
    if (px < w - 1) stack.push(idx + 1)
    if (py > 0) stack.push(idx - w)
    if (py < h - 1) stack.push(idx + w)
  }
  return n
}

/** Horizontal mirror of raw RGBA pixels, into a new array. */
export function flipXPixels(px: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length)
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < w; x++) {
      const s = row + x * 4
      const d = row + (w - 1 - x) * 4
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]
    }
  }
  return out
}

export function flipXPixelsInPlace(px: Uint8ClampedArray, w: number, h: number): void {
  const half = w >> 1
  for (let y = 0; y < h; y++) {
    const row = y * w * 4
    for (let x = 0; x < half; x++) {
      const s = row + x * 4
      const d = row + (w - 1 - x) * 4
      for (let k = 0; k < 4; k++) {
        const t = px[s + k]; px[s + k] = px[d + k]; px[d + k] = t
      }
    }
  }
}

export function flipXImage(img: PartImage): PartImage {
  return { width: img.width, height: img.height, pixels: flipXPixels(img.pixels, img.width, img.height) }
}

export function isBlank(img: PartImage): boolean {
  const p = img.pixels
  for (let i = 3; i < p.length; i += 4) if (p[i] !== 0) return false
  return true
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Bounding box of non-transparent pixels, or null when fully transparent. */
export function opaqueBounds(px: Uint8ClampedArray, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] !== 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function imagesEqual(a: PartImage, b: PartImage): boolean {
  if (a.width !== b.width || a.height !== b.height || a.pixels.length !== b.pixels.length) return false
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) return false
  return true
}

/** Copy `src` into `dst` at (dx, dy) with no blending (used for selection drops). */
export function blitCopy(dst: PartImage, src: PartImage, dx: number, dy: number, skipTransparent = true): void {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x
      if (tx < 0 || tx >= dst.width) continue
      const s = (y * src.width + x) * 4
      if (skipTransparent && src.pixels[s + 3] === 0) continue
      const d = (ty * dst.width + tx) * 4
      dst.pixels[d] = src.pixels[s]
      dst.pixels[d + 1] = src.pixels[s + 1]
      dst.pixels[d + 2] = src.pixels[s + 2]
      dst.pixels[d + 3] = src.pixels[s + 3]
    }
  }
}

/** Extract a rectangle as a new image (out-of-range areas are transparent). */
export function cropImage(src: PartImage, r: Rect): PartImage {
  const out = createImage(Math.max(0, r.w), Math.max(0, r.h))
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const c = getPixel(src, r.x + x, r.y + y)
      if (c) setPixel(out, x, y, c)
    }
  }
  return out
}

/** Clear a rectangle to transparent. */
export function clearRect(img: PartImage, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) setPixel(img, x, y, TRANSPARENT)
  }
}

/** Distinct opaque/semi-transparent colours in an image as packed 0xRRGGBBAA numbers. */
export function distinctColors(px: Uint8ClampedArray, into = new Set<number>()): Set<number> {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue
    into.add(((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0)
  }
  return into
}
