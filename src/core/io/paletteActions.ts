/**
 * Palette files. Import reads Lospec/Aseprite `.hex`, GIMP `.gpl` and JASC
 * `.pal`; export writes `.hex` or `.gpl`. Goes through the platform sink, so
 * on Android the system file picker handles it like project files.
 */
import { parsePaletteText, serializeGplPalette, serializeHexPalette } from '../../domain/palette'
import type { Palette, RGBA } from '../../domain/types'
import { getSink } from './sink'

/**
 * Extensions offered by the open dialog. `txt` is deliberately absent: on
 * Android the dialog turns known extensions into a MIME filter, and a filter of
 * only `text/plain` would grey out the `.hex` and `.gpl` files themselves.
 * With no known MIME types the picker shows every file.
 */
export const PALETTE_EXTS = ['hex', 'gpl', 'pal']

export interface ImportedPalette { name: string; colors: RGBA[] }

export async function importPaletteFile(): Promise<ImportedPalette | null> {
  const picked = await getSink().pickOpen(PALETTE_EXTS, 'Import palette')
  if (!picked) return null
  const text = new TextDecoder().decode(picked.bytes)
  const colors = parsePaletteText(text)
  if (colors.length === 0) throw new Error(`No colours found in ${picked.handle.name}. Expected a .hex list (one rrggbb per line), a GIMP .gpl or a JASC .pal file.`)
  const name = picked.handle.name.replace(/\.[^.]+$/, '').trim() || 'Imported'
  return { name, colors }
}

export async function exportPaletteFile(pal: Palette, format: 'hex' | 'gpl'): Promise<boolean> {
  const sink = getSink()
  const base = pal.name.replace(/[^\w\- ]+/g, '').trim() || 'palette'
  const handle = await sink.pickSave(`${base}.${format}`, format, 'Export palette')
  if (!handle) return false
  const text = format === 'hex' ? serializeHexPalette(pal.colors) : serializeGplPalette(pal.name, pal.colors)
  await sink.write(handle, new TextEncoder().encode(text))
  return true
}
