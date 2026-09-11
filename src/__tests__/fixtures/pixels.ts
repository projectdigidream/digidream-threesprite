import type { PartImage, RGBA } from '../../domain/types'

export const RED: RGBA = [255, 0, 0, 255]
export const GREEN: RGBA = [0, 255, 0, 255]
export const BLUE: RGBA = [0, 0, 255, 255]
export const CLEAR: RGBA = [0, 0, 0, 0]

/** Build an image from ASCII rows; `.` is transparent, any other char looks up `colors`. */
export function ascii(rows: string[], colors: Record<string, RGBA> = { X: RED, G: GREEN, B: BLUE }): PartImage {
  const h = rows.length
  const w = rows[0].length
  const pixels = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x]
      if (ch === '.') continue
      const c = colors[ch]
      if (!c) throw new Error(`unknown colour char ${ch}`)
      const i = (y * w + x) * 4
      pixels[i] = c[0]; pixels[i + 1] = c[1]; pixels[i + 2] = c[2]; pixels[i + 3] = c[3]
    }
  }
  return { width: w, height: h, pixels }
}

/** Render RGBA pixels back to ASCII for readable assertions (X = red, G = green, B = blue, ? = other opaque). */
export function toAscii(px: Uint8ClampedArray, w: number, h: number): string[] {
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    let row = ''
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = px[i + 3]
      if (a === 0) row += '.'
      else if (px[i] === 255 && px[i + 1] === 0 && px[i + 2] === 0 && a === 255) row += 'X'
      else if (px[i] === 0 && px[i + 1] === 255 && px[i + 2] === 0 && a === 255) row += 'G'
      else if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 255 && a === 255) row += 'B'
      else row += '?'
    }
    rows.push(row)
  }
  return rows
}

/** 3×3 "L": vertical bar on the left, foot along the bottom. */
export const L_ROWS = ['X..', 'X..', 'XXX']
