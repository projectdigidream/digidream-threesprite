/**
 * Trim, shelf-pack and describe frames as one sheet plus a JSON manifest.
 *
 * A line-for-line counterpart of `src-tauri/src/atlas.rs`, so a sprite exported
 * from the browser, from VS Code or from the desktop app is the same sheet with
 * the same manifest. `src/__tests__/core/atlasParity.test.ts` pins the two
 * together against a manifest the Rust side actually wrote.
 */
import { encode as encodePng } from 'fast-png'
import { opaqueBounds } from '../../domain/image'
import type { Rect } from '../../domain/image'
import { slug } from './plan'
import type { AnimationMeta, FrameRef } from './types'

export interface AtlasInput {
  sprite: string
  /** Square canvas side, in pixels. */
  canvas: number
  views: { count: number; mirror: boolean }
  worldHeight: number
  animations: AnimationMeta[]
  /** One entry per buffer, in animation → frame → view order. */
  frames: FrameRef[]
  buffers: Uint8ClampedArray[]
  /** Round the sheet's height up to a power of two. */
  pow2: boolean
}

export interface AtlasResult {
  png: Uint8Array
  /** The packed sheet as raw RGBA, for callers uploading a texture rather than writing a file. */
  rgba: Uint8ClampedArray
  /** The manifest, pretty-printed the way the Rust exporter writes it. */
  json: string
  manifest: unknown
  width: number
  height: number
  warnings: string[]
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/**
 * Shelf packing: tallest first, filling rows left to right. Returns each item's
 * position in input order, plus the sheet size.
 */
export function pack(sizes: [number, number][], padding: number, pow2Height: boolean): { pos: [number, number][]; width: number; height: number } {
  if (sizes.length === 0) return { pos: [], width: 1, height: 1 }
  let area = 0
  let maxW = 1
  for (const [w, h] of sizes) {
    area += (w + padding) * (h + padding)
    maxW = Math.max(maxW, w + padding)
  }
  const width = Math.max(nextPow2(Math.max(Math.ceil(Math.sqrt(area * 1.15)), maxW)), 1)
  const order = sizes.map((_, i) => i)
  order.sort((a, b) => sizes[b][1] - sizes[a][1] || sizes[b][0] - sizes[a][0] || a - b)

  const pos: [number, number][] = sizes.map(() => [0, 0])
  let x = padding
  let y = padding
  let shelfH = 0
  for (const i of order) {
    const [w, h] = sizes[i]
    if (x + w + padding > width) {
      x = padding
      y += shelfH + padding
      shelfH = 0
    }
    pos[i] = [x, y]
    x += w + padding
    shelfH = Math.max(shelfH, h)
  }
  let height = y + shelfH + padding
  if (pow2Height) height = nextPow2(height)
  return { pos, width, height: Math.max(height, 1) }
}

export function buildAtlas(input: AtlasInput): AtlasResult {
  const n = input.canvas
  const padding = 1
  const warnings: string[] = []

  // trim; a fully transparent frame still needs a slot
  const trims: Rect[] = input.buffers.map((buf, i) => {
    const b = opaqueBounds(buf, n, n)
    if (b) return b
    const fr = input.frames[i]
    warnings.push(`${input.animations[fr.anim].name}: frame ${fr.frame + 1} view ${fr.view} is empty`)
    return { x: 0, y: 0, w: 1, h: 1 }
  })

  const { pos, width, height } = pack(trims.map(t => [t.w, t.h] as [number, number]), padding, input.pow2)

  const sheet = new Uint8ClampedArray(width * height * 4)
  input.buffers.forEach((buf, i) => {
    if (!opaqueBounds(buf, n, n)) return
    const t = trims[i]
    const [px, py] = pos[i]
    for (let y = 0; y < t.h; y++) {
      const src = ((t.y + y) * n + t.x) * 4
      const dst = ((py + y) * width + px) * 4
      sheet.set(buf.subarray(src, src + t.w * 4), dst)
    }
  })
  const png = encodePng({ width, height, data: new Uint8Array(sheet.buffer, sheet.byteOffset, sheet.length), channels: 4 })

  const nviews = input.views.count
  const authored = input.views.mirror ? Math.floor(nviews / 2) + 1 : nviews
  const views = []
  for (let k = 1; k <= nviews; k++) {
    const derived = input.views.mirror && k > authored
    views.push({
      index: k,
      angleDeg: ((k - 1) * 360) / nviews,
      mirrored: derived,
      mirrorOf: derived ? ((nviews - (k - 1)) % nviews) + 1 : null,
    })
  }

  const frames: Record<string, { rect: Rect; source: Rect; pivot: { x: number; y: number } }> = {}
  const animFrames: Record<string, string>[][] = input.animations.map(a => Array.from({ length: a.frameCount }, () => ({})))
  input.frames.forEach((fr, i) => {
    const key = `${slug(input.animations[fr.anim].name)}/${fr.frame}/v${fr.view}`
    const t = trims[i]
    const [px, py] = pos[i]
    // the feet point (bottom centre of the canvas) relative to the trimmed rect
    const feetX = n / 2
    const feetY = n
    frames[key] = {
      rect: { x: px, y: py, w: t.w, h: t.h },
      source: t,
      pivot: { x: (feetX - t.x) / t.w, y: (feetY - t.y) / t.h },
    }
    const row = animFrames[fr.anim]?.[fr.frame]
    if (row) row[String(fr.view)] = key
  })

  const manifest = {
    format: 'threesprite-atlas',
    version: 1,
    sprite: input.sprite,
    canvas: { w: n, h: n },
    worldHeight: input.worldHeight,
    image: `${input.sprite}.png`,
    size: { w: width, h: height },
    conventions:
      "angleDeg = camera bearing relative to the character's facing, anticlockwise seen from above; 0 = character faces the camera. pivot is the feet point (bottom centre of the canvas) relative to each trimmed rect, normalised to its size.",
    views: { count: nviews, mirror: input.views.mirror, list: views },
    frames,
    animations: input.animations.map((a, ai) => ({
      name: a.name,
      fps: a.fps,
      loop: a.loop,
      frames: animFrames[ai].map((views2, fi) => ({ index: fi, views: views2 })),
    })),
  }

  return { png, rgba: sheet, json: JSON.stringify(manifest, null, 2), manifest, width, height, warnings }
}
