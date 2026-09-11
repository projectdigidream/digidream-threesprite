/**
 * `.tsprite` = a zip with `project.json` (the document, images replaced by
 * file references), `parts/<part>/<variant>/v<k>.png` (lossless RGBA), and
 * `thumbnail.png`. Pure TypeScript (fflate + fast-png) so it is identical in
 * the browser, on desktop and on Android, and testable under vitest.
 */
import { decode as decodePng, encode as encodePng } from 'fast-png'
import { unzipSync, zipSync } from 'fflate'
import { validate } from '../../domain/project'
import { FORMAT_VERSION, type PartImage, type Project } from '../../domain/types'
import { composeFrame } from '../raster/rasterizer'

export const PROJECT_EXT = 'tsprite'

interface ImageRef { $file: string; width: number; height: number }

export function encodeProject(p: Project): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const json = JSON.parse(JSON.stringify(p, (key, value) => {
    // PartImage → reference; the pixels go into their own PNG entry
    if (value && typeof value === 'object' && 'pixels' in value && value.pixels instanceof Uint8ClampedArray) {
      return undefined // handled below by walking the structure
    }
    void key
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
        files[name] = pngFromImage(img)
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
  const raw = JSON.parse(new TextDecoder().decode(jsonBytes)) as Project
  if (raw.formatVersion !== FORMAT_VERSION) throw new Error(`Unsupported project format version ${raw.formatVersion} (this app reads ${FORMAT_VERSION})`)
  const warnings: string[] = []
  for (const part of Object.values(raw.parts)) {
    for (const v of Object.values(part.variants)) {
      const refs = v.images as unknown as Record<string, ImageRef>
      const images: Record<number, PartImage> = {}
      for (const [k, ref] of Object.entries(refs)) {
        const data = entries[ref.$file]
        if (!data) { warnings.push(`Missing image ${ref.$file}`); continue }
        try {
          images[Number(k)] = imageFromPng(data)
        } catch (e) {
          warnings.push(`Could not read ${ref.$file}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      v.images = images
    }
  }
  const problems = validate(raw)
  if (problems.length) warnings.push(...problems.map(p => `Repairing: ${p}`))
  return { project: raw, warnings }
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
    // indexed colour: fast-png exposes the palette; alpha comes from tRNS if present
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
