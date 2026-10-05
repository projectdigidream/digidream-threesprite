/**
 * Palette files, the same set qPainter reads and writes so a palette can move
 * between the two by file: Lospec/Aseprite `.hex`, GIMP `.gpl`, JASC `.pal`,
 * Lospec's one-pixel-per-colour `.png` strip, and the palette out of a JSON
 * project. Everything goes through the platform sink, so on Android the system
 * file picker handles it exactly like project files.
 */
import { colorsFromPixels, MAX_PALETTE, parsePaletteText, paletteStripImage, serializeGplPalette, serializeHexPalette, serializeJascPalette } from '../../domain/palette'
import type { Palette, RGBA } from '../../domain/types'
import { imageFromPng, pngFromImage } from './projectFile'
import { getSink } from './sink'

/**
 * Extensions offered by the open dialog. `txt` is deliberately absent: on
 * Android the dialog turns known extensions into a MIME filter, and a filter of
 * only `text/plain` would grey out the `.hex` and `.gpl` files themselves.
 * With no known MIME types the picker shows every file.
 */
export const PALETTE_EXTS = ['hex', 'gpl', 'pal', 'png', 'json']

export type PaletteFormat = 'hex' | 'gpl' | 'pal' | 'png'

export interface ImportedPalette { name: string; colors: RGBA[] }

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]
const isPng = (b: Uint8Array) => b.length > 8 && PNG_MAGIC.every((v, i) => b[i] === v)

/** Any image the platform can decode, for the formats fast-png does not cover. */
async function pixelsViaCanvas(bytes: Uint8Array, type: string): Promise<Uint8ClampedArray> {
  const blob = new Blob([bytes as unknown as BlobPart], { type })
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('This platform cannot decode that image.')
  ctx.drawImage(bitmap, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  bitmap.close?.()
  return data
}

const mimeFor = (name: string): string => {
  const ext = /\.([^.]+)$/.exec(name.toLowerCase())?.[1] ?? ''
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext ? `image/${ext}` : 'application/octet-stream'
}

/**
 * Read a palette from a file. A PNG is read as a swatch strip — really any
 * image is, taking its colours in the order they appear and reducing to
 * MAX_PALETTE by median cut — and everything else as text.
 */
export async function importPaletteFile(): Promise<ImportedPalette | null> {
  const picked = await getSink().pickOpen(PALETTE_EXTS, 'Import palette')
  if (!picked) return null
  const name = picked.handle.name.replace(/\.[^.]+$/, '').replace(/\.texproj$/i, '').trim() || 'Imported'

  let colors: RGBA[]
  if (isPng(picked.bytes)) {
    colors = colorsFromPixels(imageFromPng(picked.bytes).pixels, MAX_PALETTE)
  } else if (/\.(jpe?g|gif|webp|bmp|avif)$/i.test(picked.handle.name)) {
    colors = colorsFromPixels(await pixelsViaCanvas(picked.bytes, mimeFor(picked.handle.name)), MAX_PALETTE)
  } else {
    colors = parsePaletteText(new TextDecoder().decode(picked.bytes))
  }

  if (colors.length === 0) {
    throw new Error(`No colours found in ${picked.handle.name}. Expected a .hex list (one rrggbb per line), a GIMP .gpl, a JASC .pal, an image, or a project file holding a palette.`)
  }
  return { name, colors }
}

/** `colors` overrides the palette's own, which is how "only what the sprite uses" is exported. */
export async function exportPaletteFile(pal: Palette, format: PaletteFormat, colors: readonly RGBA[] = pal.colors): Promise<boolean> {
  const sink = getSink()
  const base = pal.name.replace(/[^\w\- ]+/g, '').trim() || 'palette'
  const handle = await sink.pickSave(`${base}.${format}`, format, 'Export palette')
  if (!handle) return false
  await sink.write(handle, paletteFileBytes(pal.name, format, colors))
  return true
}

export function paletteFileBytes(name: string, format: PaletteFormat, colors: readonly RGBA[]): Uint8Array {
  if (format === 'png') return pngFromImage(paletteStripImage(colors))
  const text = format === 'hex' ? serializeHexPalette(colors)
    : format === 'gpl' ? serializeGplPalette(name, colors)
    : serializeJascPalette(colors)
  return new TextEncoder().encode(text)
}
