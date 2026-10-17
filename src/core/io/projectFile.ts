/**
 * `.tsprite` = a zip with `project.json` (the document, images replaced by
 * file references), `parts/<part>/<variant>/v<k>.png` (lossless RGBA), and
 * `thumbnail.png`. Pure TypeScript (fflate + fast-png) so it is identical in
 * the browser, on desktop and on Android, and testable under vitest.
 */
import { decode as decodePng, encode as encodePng } from 'fast-png'
import { unzipSync, zipSync } from 'fflate'
import { createPalette, DEFAULT_PALETTE, presetNameFor } from '../../domain/palette'
import { clampDepthScale, repairPalettes, repairPartOrders, validate } from '../../domain/project'
import { FORMAT_VERSION, type PartImage, type Project, type RGBA } from '../../domain/types'
import { composeFrame } from '../raster/rasterizer'

export const PROJECT_EXT = 'tsprite'

interface ImageRef { $file: string; width: number; height: number }

// Document images are never written in place: an edit draws into a copy and
// swaps it in (see the editor store). So an image's PNG stays valid for as
// long as the image lives, and an autosave re-encodes only what changed.
const pngCache = new WeakMap<PartImage, Uint8Array>()
function cachedPng(img: PartImage): Uint8Array {
  let png = pngCache.get(img)
  if (!png) { png = pngFromImage(img); pngCache.set(img, png) }
  return png
}

export function encodeProject(p: Project): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const json = JSON.parse(JSON.stringify(p, (_key, value) => {
    if (value && typeof value === 'object' && 'pixels' in value && value.pixels instanceof Uint8ClampedArray) return undefined
    return value
  })) as Project
  for (const partId of Object.keys(p.parts)) {
    const part = p.parts[partId]
    for (const variantId of Object.keys(part.variants)) {
      const v = part.variants[variantId]
      const target = json.parts[partId].variants[variantId] as unknown as { images: Record<number, ImageRef> }
      target.images = {}
      for (const [k, img] of Object.entries(v.images)) {
        const name = `parts/${partId}/${variantId}/v${k}.png`
        files[name] = cachedPng(img)
        target.images[Number(k)] = { $file: name, width: img.width, height: img.height }
      }
    }
  }
  files['project.json'] = new TextEncoder().encode(JSON.stringify(json, null, 2))
  try {
    files['thumbnail.png'] = thumbnail(p)
  } catch {
    /* a thumbnail is a nicety */
  }
  return zipSync(files, { level: 6 })
}

export interface DecodedProject { project: Project; warnings: string[] }

export function decodeProject(bytes: Uint8Array): DecodedProject {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch (e) {
    throw new Error(`Not a ThreeSprite project (zip): ${e instanceof Error ? e.message : String(e)}`)
  }
  const jsonBytes = entries['project.json']
  if (!jsonBytes) throw new Error('Not a ThreeSprite project: project.json missing')
  const parsed = JSON.parse(new TextDecoder().decode(jsonBytes)) as { formatVersion: number }
  const warnings: string[] = []
  if (parsed.formatVersion === 1) {
    migrateV1(parsed as unknown as V1Project)
    warnings.push('Upgraded a version-1 project: bones were converted to the 3D rig; check the rest pose.')
  }
  if (parsed.formatVersion === 2) migrateV2(parsed as unknown as V2Project)
  if (parsed.formatVersion !== FORMAT_VERSION) throw new Error(`Unsupported project format version ${parsed.formatVersion} (this app reads ${FORMAT_VERSION})`)
  const raw = parsed as unknown as Project
  for (const part of Object.values(raw.parts)) {
    if (part.foreshorten === undefined) part.foreshorten = true
    for (const v of Object.values(part.variants)) {
      const refs = v.images as unknown as Record<string, ImageRef>
      const images: Record<number, PartImage> = {}
      for (const [k, ref] of Object.entries(refs)) {
        const data = entries[ref.$file]
        if (!data) { warnings.push(`Missing image ${ref.$file}`); continue }
        try {
          const img = imageFromPng(data)
          // The file's own PNG decodes to these pixels, so it can be written back as it is.
          pngCache.set(img, data)
          images[Number(k)] = img
        } catch (e) {
          warnings.push(`Could not read ${ref.$file}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      v.images = images
    }
  }
  if (raw.views.elevationDeg === undefined) raw.views.elevationDeg = 0
  if (raw.views.depthScale === undefined) {
    // the setting shipped once as a camera distance in canvas heights
    const d = (raw.views as { cameraDistance?: number }).cameraDistance
    raw.views.depthScale = d && d > 0 ? clampDepthScale(1 / d) : 0
    delete (raw.views as { cameraDistance?: number }).cameraDistance
  }
  if (!raw.partOrderByView) raw.partOrderByView = {}
  warnings.push(...repairPartOrders(raw))
  const problems = validate(raw)
  if (problems.length) warnings.push(...problems.map(p => `Repairing: ${p}`))
  repairPalettes(raw)
  return { project: raw, warnings }
}

// ── v2 (one anonymous palette) → v3 (named palettes, one active) ─────────────

interface V2Project {
  formatVersion: number
  palette?: { colors?: unknown }
  palettes?: unknown
  paletteOrder?: unknown
  activePaletteId?: unknown
}

function migrateV2(p: V2Project): void {
  const raw = Array.isArray(p.palette?.colors) ? (p.palette!.colors as unknown[]) : DEFAULT_PALETTE
  const colors = raw.filter((c): c is RGBA => Array.isArray(c) && c.length === 4 && c.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
  const pal = createPalette(presetNameFor(colors) ?? 'Palette', colors)
  p.palettes = { [pal.id]: pal }
  p.paletteOrder = [pal.id]
  p.activePaletteId = pal.id
  delete p.palette
  p.formatVersion = 3
}

// ── v1 (2D bones) → v2 (3D bones) ────────────────────────────────────────────

interface V1Transform { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
interface V1Project {
  formatVersion: number
  canvas: { size: number }
  views: { count: number; mirror: boolean; elevationDeg?: number; depthScale?: number }
  skeleton: { bones: Record<string, { parentId: string | null; rest: unknown }> }
  animations: Record<string, { boneTracks: Record<string, { rotation: { value: unknown }[]; translate: { value: unknown }[]; scale: { value: unknown }[] }> }>
}

function migrateV1(p: V1Project): void {
  const size = p.canvas.size
  for (const b of Object.values(p.skeleton.bones)) {
    const r = b.rest as V1Transform
    if (typeof r !== 'object' || r === null || 'position' in r) continue
    const root = b.parentId === null
    b.rest = root
      ? { position: { r: -(r.x - size / 2), u: size - r.y, f: 0 }, rotation: { r: 0, u: 0, f: r.rotation - 90 } }
      : { position: { r: -r.y, u: r.x, f: 0 }, rotation: { r: 0, u: 0, f: r.rotation } }
  }
  for (const anim of Object.values(p.animations)) {
    for (const [bid, t] of Object.entries(anim.boneTracks)) {
      const root = p.skeleton.bones[bid]?.parentId === null
      for (const k of t.rotation) if (typeof k.value === 'number') k.value = { r: 0, u: 0, f: k.value }
      for (const k of t.translate) {
        const v = k.value as { x: number; y: number }
        if (v && typeof v.x === 'number') k.value = root ? { r: -v.x, u: -v.y, f: 0 } : { r: -v.y, u: v.x, f: 0 }
      }
      for (const k of t.scale) {
        const v = k.value as { x: number; y: number }
        if (v && typeof v.x === 'number') k.value = { r: v.y, u: v.x, f: 1 }
      }
    }
  }
  p.views.elevationDeg = 0
  p.formatVersion = 2
}

export function pngFromImage(img: PartImage): Uint8Array {
  return encodePng({ width: img.width, height: img.height, data: new Uint8Array(img.pixels.buffer, img.pixels.byteOffset, img.pixels.length), channels: 4 })
}

/** Decode any PNG to a straight-alpha RGBA8 PartImage. */
export function imageFromPng(bytes: Uint8Array): PartImage {
  const d = decodePng(bytes)
  const n = d.width * d.height
  const out = new Uint8ClampedArray(n * 4)
  const src = d.data
  const shift = d.depth === 16 ? 8 : 0
  const ch = d.channels
  const pal = d.palette
  if (pal && ch === 1) {
    for (let i = 0; i < n; i++) {
      const idx = src[i] >> shift
      const c = pal[idx] ?? [0, 0, 0]
      out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c.length > 3 ? (c[3] as number) : 255
    }
    return { width: d.width, height: d.height, pixels: out }
  }
  for (let i = 0; i < n; i++) {
    const s = i * ch
    if (ch === 4) { out[i * 4] = src[s] >> shift; out[i * 4 + 1] = src[s + 1] >> shift; out[i * 4 + 2] = src[s + 2] >> shift; out[i * 4 + 3] = src[s + 3] >> shift }
    else if (ch === 3) { out[i * 4] = src[s] >> shift; out[i * 4 + 1] = src[s + 1] >> shift; out[i * 4 + 2] = src[s + 2] >> shift; out[i * 4 + 3] = 255 }
    else if (ch === 2) { const g = src[s] >> shift; out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = src[s + 1] >> shift }
    else { const g = src[s] >> shift; out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = 255 }
  }
  return { width: d.width, height: d.height, pixels: out }
}

/** Frame 0 of the first animation, view 1, as a PNG. */
export function thumbnail(p: Project): Uint8Array {
  const n = p.canvas.size
  const px = composeFrame(p, p.animationOrder[0] ?? null, 0, 1)
  return encodePng({ width: n, height: n, data: new Uint8Array(px.buffer, px.byteOffset, px.length), channels: 4 })
}

export function projectFileName(p: Project): string {
  const base = p.name.replace(/[^\w\- ]+/g, '').trim() || p.spriteName || 'sprite'
  return `${base}.${PROJECT_EXT}`
}
