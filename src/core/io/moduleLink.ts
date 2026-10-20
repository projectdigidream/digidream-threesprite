/**
 * The module ThreeSprite is embedded in (the studio): its textures, painted in
 * qPainter, become part images or palettes directly, with no file in between.
 */
import { colorsFromPixels, MAX_PALETTE, parsePaletteText } from '../../domain/palette'
import type { PartImage, RGBA } from '../../domain/types'
import { imageFromPng } from './projectFile'
import { askChoice } from '../ui/dialogs'
import type { ImportedPalette } from './paletteActions'
import { addImagePart } from './projectActions'
import { hostFiles } from './sink'

interface TexProj { w: number; h: number; frame?: number; palette?: unknown; layers?: { visible?: boolean; opacity?: number; cels?: (string | null)[] }[] }

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47

function pngFromDataUrl(url: string): Uint8Array {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A texture as one picture: a PNG as it is, a qPainter project flattened (its current frame, visible layers, each at its opacity). */
export function textureImage(bytes: Uint8Array): PartImage {
  if (isPng(bytes)) return imageFromPng(bytes)
  const p = JSON.parse(new TextDecoder().decode(bytes)) as TexProj
  const out: PartImage = { width: p.w, height: p.h, pixels: new Uint8ClampedArray(p.w * p.h * 4) }
  const d = out.pixels
  for (const layer of p.layers ?? []) {
    const cel = layer.cels?.[p.frame ?? 0] ?? layer.cels?.[0]
    if (layer.visible === false || !cel) continue
    const src = imageFromPng(pngFromDataUrl(cel))
    const op = layer.opacity ?? 1
    for (let y = 0; y < Math.min(p.h, src.height); y++) for (let x = 0; x < Math.min(p.w, src.width); x++) {
      const s = (y * src.width + x) * 4, t = (y * p.w + x) * 4
      const a = (src.pixels[s + 3] / 255) * op
      if (a <= 0) continue
      // straight alpha "over"
      const da = d[t + 3] / 255, oa = a + da * (1 - a)
      for (let c = 0; c < 3; c++) d[t + c] = (src.pixels[s + c] * a + d[t + c] * da * (1 - a)) / oa
      d[t + 3] = oa * 255
    }
  }
  return out
}

/** A texture's colours: a qPainter project's own palette, else the colours its picture uses. */
export function textureColours(bytes: Uint8Array): RGBA[] {
  if (!isPng(bytes)) {
    const own = parsePaletteText(new TextDecoder().decode(bytes))
    if (own.length) return own
  }
  return colorsFromPixels(textureImage(bytes).pixels, MAX_PALETTE)
}

export const moduleLibrary = () => hostFiles()?.library ?? null

/** Pick one of the module's textures and add it as a new part. Null when cancelled. */
export async function importModuleTexture(): Promise<string | null> {
  const lib = moduleLibrary()
  if (!lib) return null
  const names = await lib.textures()
  if (!names.length) throw new Error('This module has no textures yet.')
  const name = await askChoice('A texture from the module, as a new part', names)
  if (!name) return null
  return addImagePart(textureImage(await lib.texture(name)), name)
}

const MODULE_PALETTE = "The module's palette"

/** Pick the module's palette or a texture's colours. Null when cancelled. */
export async function importModulePalette(): Promise<ImportedPalette | null> {
  const lib = moduleLibrary()
  if (!lib) return null
  const own = await lib.palette()
  const names = await lib.textures()
  const choice = await askChoice('Colours from the module', [...(own ? [MODULE_PALETTE] : []), ...names.map(n => `Texture ${n}`)])
  if (!choice) return null
  const colors = choice === MODULE_PALETTE ? parsePaletteText(own!) : textureColours(await lib.texture(choice.slice('Texture '.length)))
  if (!colors.length) throw new Error(`No colours found in ${choice}.`)
  return { name: choice === MODULE_PALETTE ? 'Module' : choice.slice('Texture '.length), colors }
}
