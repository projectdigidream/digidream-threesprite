import { newId } from './ids'
import type { Palette, PartImage, Project, RGBA } from './types'

export const MAX_PALETTE = 256

// ── presets ──────────────────────────────────────────────────────────────────

export interface PalettePreset { name: string; colors: RGBA[] }

const hex = (...list: string[]): RGBA[] => list.map(h => {
  const v = parseInt(h, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255] as const
})

const grays = (n: number): RGBA[] => Array.from({ length: n }, (_, i) => {
  const v = Math.round((i * 255) / (n - 1))
  return [v, v, v, 255] as const
})

/** Well-known free pixel-art palettes. The first one is the default for new projects. */
export const PRESET_PALETTES: readonly PalettePreset[] = [
  {
    name: 'DawnBringer 16',
    colors: hex('140c1c', '442434', '30346d', '4e4a4e', '854c30', '346524', 'd04648', '757161', '597dce', 'd27d2c', '8595a1', '6daa2c', 'd2aa99', '6dc2ca', 'dad45e', 'deeed6'),
  },
  {
    name: 'DawnBringer 32',
    colors: hex(
      '000000', '222034', '45283c', '663931', '8f563b', 'df7126', 'd9a066', 'eec39a', 'fbf236', '99e550', '6abe30', '37946e', '4b692f', '524b24', '323c39', '3f3f74',
      '306082', '5b6ee1', '639bff', '5fcde4', 'cbdbfc', 'ffffff', '9badb7', '847e87', '696a6a', '595652', '76428a', 'ac3232', 'd95763', 'd77bba', '8f974a', '8a6f30',
    ),
  },
  {
    name: 'PICO-8',
    colors: hex('000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8', 'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'),
  },
  {
    name: 'Sweetie 16',
    colors: hex('1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179', '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57'),
  },
  {
    name: 'Endesga 32',
    colors: hex(
      'be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633', 'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e',
      '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bb4', '5a6988', '3a4466', '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569',
    ),
  },
  {
    name: 'Game Boy',
    colors: hex('0f380f', '306230', '8bac0f', '9bbc0f'),
  },
  {
    name: 'Greyscale 16',
    colors: grays(16),
  },
]

/** The default palette for new projects (DawnBringer 16, public domain). */
export const DEFAULT_PALETTE: RGBA[] = PRESET_PALETTES[0].colors

/** Name of the preset whose colours equal `colors` exactly (same order), if any. */
export function presetNameFor(colors: readonly RGBA[]): string | null {
  for (const p of PRESET_PALETTES) {
    if (p.colors.length !== colors.length) continue
    if (p.colors.every((c, i) => sameColor(c, colors[i]))) return p.name
  }
  return null
}

// ── colours ──────────────────────────────────────────────────────────────────

export function sameColor(a: RGBA, b: RGBA): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]
}

export function cloneColor(c: RGBA): RGBA {
  return [c[0], c[1], c[2], c[3]]
}

export function addColor(colors: RGBA[], c: RGBA): number {
  const i = colors.findIndex(x => sameColor(x, c))
  if (i >= 0) return i
  if (colors.length >= MAX_PALETTE) return -1
  colors.push(cloneColor(c))
  return colors.length - 1
}

/** Insert (or duplicate) a colour at `index`; returns the index or -1 when full. */
export function insertColor(colors: RGBA[], index: number, c: RGBA): number {
  if (colors.length >= MAX_PALETTE) return -1
  const at = Math.min(Math.max(0, index), colors.length)
  colors.splice(at, 0, cloneColor(c))
  return at
}

export function removeColor(colors: RGBA[], index: number): void {
  if (index >= 0 && index < colors.length) colors.splice(index, 1)
}

/** Move the colour at `from` so it lands at index `to`. Returns the new index. */
export function moveColor(colors: RGBA[], from: number, to: number): number {
  if (from < 0 || from >= colors.length) return from
  const dst = Math.min(Math.max(0, to), colors.length - 1)
  if (dst === from) return from
  const [c] = colors.splice(from, 1)
  colors.splice(dst, 0, c)
  return dst
}

/** Sort dark → light; equal lightness by hue. Stable for identical colours. */
export function sortColors(colors: RGBA[]): void {
  const key = (c: RGBA) => {
    const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return [Math.round(lum / 8), hueOf(c)] as const
  }
  const indexed = colors.map((c, i) => ({ c, i, k: key(c) }))
  indexed.sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
  for (let i = 0; i < indexed.length; i++) colors[i] = indexed[i].c
}

function hueOf(c: RGBA): number {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return h
}

/** Replace every pixel equal to `from` with `to`, in place. Returns pixels changed. */
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

/**
 * Like `replaceColor` but returns a new image and leaves `img` untouched, or
 * null when no pixel matched. Use this inside `commit()`: pixel buffers are not
 * drafted by immer, so editing them in place would bypass undo.
 */
export function replaceColorCopy(img: PartImage, from: RGBA, to: RGBA): PartImage | null {
  const p = img.pixels
  let first = -1
  for (let i = 0; i < p.length; i += 4) {
    if (p[i] === from[0] && p[i + 1] === from[1] && p[i + 2] === from[2] && p[i + 3] === from[3]) { first = i; break }
  }
  if (first < 0) return null
  const out: PartImage = { width: img.width, height: img.height, pixels: new Uint8ClampedArray(p) }
  const q = out.pixels
  for (let i = first; i < q.length; i += 4) {
    if (q[i] === from[0] && q[i + 1] === from[1] && q[i + 2] === from[2] && q[i + 3] === from[3]) {
      q[i] = to[0]; q[i + 1] = to[1]; q[i + 2] = to[2]; q[i + 3] = to[3]
    }
  }
  return out
}

/** Replace `from` with `to` in every image of the project (copy-on-write). Returns images changed. */
export function recolorProject(p: Project, from: RGBA, to: RGBA): number {
  if (sameColor(from, to)) return 0
  let n = 0
  for (const part of Object.values(p.parts)) {
    for (const v of Object.values(part.variants)) {
      for (const k of Object.keys(v.images)) {
        const img = v.images[Number(k)]
        if (!img) continue
        const r = replaceColorCopy(img, from, to)
        if (r) { v.images[Number(k)] = r; n++ }
      }
    }
  }
  return n
}

/** Every distinct non-transparent colour drawn in the project, dark → light. */
export function collectImageColors(p: Project): RGBA[] {
  const seen = new Map<number, RGBA>()
  for (const part of Object.values(p.parts)) {
    for (const v of Object.values(part.variants)) {
      for (const img of Object.values(v.images)) {
        const px = img.pixels
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] === 0) continue
          const key = ((px[i] << 24) | (px[i + 1] << 16) | (px[i + 2] << 8) | px[i + 3]) >>> 0
          if (!seen.has(key)) seen.set(key, [px[i], px[i + 1], px[i + 2], px[i + 3]])
        }
      }
    }
  }
  const out = [...seen.values()]
  sortColors(out)
  return out.slice(0, MAX_PALETTE)
}

// ── hex ──────────────────────────────────────────────────────────────────────

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

// ── palette files ────────────────────────────────────────────────────────────

/**
 * Read a palette from text. Understands GIMP `.gpl`, JASC `.pal`, and plain
 * hex lists (Lospec `.hex`, one `rrggbb` per line, `#` optional, comments after
 * `;` or `//`). Duplicates are dropped; the result is capped at MAX_PALETTE.
 */
export function parsePaletteText(text: string): RGBA[] {
  const out: RGBA[] = []
  const push = (c: RGBA) => { if (!out.some(x => sameColor(x, c)) && out.length < MAX_PALETTE) out.push(c) }
  const lines = text.split(/\r?\n/)
  const head = (lines[0] ?? '').trim()

  if (/^GIMP Palette/i.test(head)) {
    for (const raw of lines.slice(1)) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || /^(Name|Columns)\s*:/i.test(line)) continue
      const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(line)
      if (m) push([clamp255(+m[1]), clamp255(+m[2]), clamp255(+m[3]), 255])
    }
    return out
  }

  if (/^JASC-PAL/i.test(head)) {
    for (const raw of lines.slice(3)) {
      const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(raw)
      if (m) push([clamp255(+m[1]), clamp255(+m[2]), clamp255(+m[3]), 255])
    }
    return out
  }

  for (const raw of lines) {
    const line = raw.replace(/(;|\/\/).*$/, '')
    for (const tok of line.split(/[\s,]+/)) {
      const m = /^(?:#|0x)?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(tok)
      if (!m) continue
      const v = parseInt(m[1], 16)
      push([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255])
    }
  }
  return out
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)))

/** Lospec / Aseprite `.hex`: one lowercase `rrggbb` per line, no `#`. */
export function serializeHexPalette(colors: readonly RGBA[]): string {
  return colors.map(c => rgbaToHex(c).slice(1)).join('\n') + '\n'
}

/** GIMP `.gpl` (also read by Aseprite, Krita, Inkscape). */
export function serializeGplPalette(name: string, colors: readonly RGBA[]): string {
  const rows = colors.map(c => `${String(c[0]).padStart(3)} ${String(c[1]).padStart(3)} ${String(c[2]).padStart(3)}\t${rgbaToHex(c)}`)
  return `GIMP Palette\nName: ${name.replace(/[\r\n]+/g, ' ')}\nColumns: 8\n#\n${rows.join('\n')}\n`
}

// ── palettes in a project ────────────────────────────────────────────────────

export function createPalette(name: string, colors: readonly RGBA[]): Palette {
  return { id: newId(), name, colors: colors.slice(0, MAX_PALETTE).map(cloneColor) }
}

const EMPTY_PALETTE: Palette = Object.freeze({ id: '', name: '', colors: Object.freeze([]) as unknown as RGBA[] })

/**
 * The palette the Draw tab shows. Falls back to the first one, then to a shared
 * empty palette (stable reference, so store selectors never churn), so callers
 * never crash on a document that is mid-repair.
 */
export function activePalette(p: Project): Palette {
  return p.palettes[p.activePaletteId] ?? p.palettes[p.paletteOrder[0]] ?? EMPTY_PALETTE
}

/** `base`, or `base 2`, `base 3`, … — whichever is not taken. */
export function uniquePaletteName(p: Project, base: string): string {
  const taken = new Set(Object.values(p.palettes).map(x => x.name))
  const clean = base.trim() || 'Palette'
  if (!taken.has(clean)) return clean
  for (let n = 2; ; n++) if (!taken.has(`${clean} ${n}`)) return `${clean} ${n}`
}
