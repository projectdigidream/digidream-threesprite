import type { PartImage, RGBA } from './types'

/** A pleasant 16-colour starting palette (DawnBringer 16, public domain). */
export const DEFAULT_PALETTE: RGBA[] = [
  [20, 12, 28, 255],
  [68, 36, 52, 255],
  [48, 52, 109, 255],
  [78, 74, 78, 255],
  [133, 76, 48, 255],
  [52, 101, 36, 255],
  [208, 70, 72, 255],
  [117, 113, 97, 255],
  [89, 125, 206, 255],
  [210, 125, 44, 255],
  [133, 149, 161, 255],
  [109, 170, 44, 255],
  [210, 170, 153, 255],
  [109, 194, 202, 255],
  [218, 212, 94, 255],
  [222, 238, 214, 255],
]

export const MAX_PALETTE = 256

export function addColor(colors: RGBA[], c: RGBA): number {
  const i = colors.findIndex(x => x[0] === c[0] && x[1] === c[1] && x[2] === c[2] && x[3] === c[3])
  if (i >= 0) return i
  if (colors.length >= MAX_PALETTE) return -1
  colors.push([c[0], c[1], c[2], c[3]])
  return colors.length - 1
}

export function removeColor(colors: RGBA[], index: number): void {
  if (index >= 0 && index < colors.length) colors.splice(index, 1)
}

/** Replace every pixel equal to `from` with `to`. Returns pixels changed. */
export function replaceColor(img: PartImage, from: RGBA, to: RGBA): number {
  const p = img.pixels
  let n = 0
  for (let i = 0; i < p.length; i += 4) {
    if (p[i] === from[0] && p[i + 1] === from[1] && p[i + 2] === from[2] && p[i + 3] === from[3]) {
      p[i] = to[0]; p[i + 1] = to[1]; p[i + 2] = to[2]; p[i + 3] = to[3]
      n++
    }
  }
  return n
}

export function rgbaToHex(c: RGBA): string {
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`
}

export function hexToRgba(hex: string, alpha = 255): RGBA | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha]
}
