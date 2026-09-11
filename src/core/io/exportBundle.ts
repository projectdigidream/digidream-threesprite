/**
 * Builds the binary bundle the Rust exporter consumes:
 * `u32le manifest_len | manifest JSON | frame RGBA…` with frames in
 * animation → frame → view order, every view materialised (mirrored views are
 * flipped composites, exactly what the preview shows).
 */
import { composeFrame } from '../raster/rasterizer'
import type { Id, Project } from '../../domain/types'
import type { AnimationMeta, BundleManifest, ExportSelection, FrameRef, SinkSpec } from '../export/types'

export interface CollectedFrames {
  animations: AnimationMeta[]
  frames: FrameRef[]
  buffers: Uint8ClampedArray[]
}

export function collectFrames(project: Project, animIds: Id[], onProgress?: (done: number, total: number) => void): CollectedFrames {
  const N = project.views.count
  const anims = project.animationOrder.filter(id => animIds.includes(id)).map(id => project.animations[id])
  const total = anims.reduce((a, x) => a + x.frameCount, 0) * N
  const animations: AnimationMeta[] = anims.map(a => ({ name: a.name, fps: a.fps, loop: a.loop, frameCount: a.frameCount }))
  const frames: FrameRef[] = []
  const buffers: Uint8ClampedArray[] = []
  let done = 0
  anims.forEach((anim, ai) => {
    for (let f = 0; f < anim.frameCount; f++) {
      for (let v = 1; v <= N; v++) {
        frames.push({ anim: ai, frame: f, view: v })
        buffers.push(composeFrame(project, anim.id, f, v))
        onProgress?.(++done, total)
      }
    }
  })
  return { animations, frames, buffers }
}

export function buildManifest(project: Project, sel: ExportSelection, sink: SinkSpec, collected: CollectedFrames): BundleManifest {
  return {
    format: sel.format,
    sink,
    sprite: project.spriteName,
    canvas: project.canvas.size,
    views: { count: project.views.count, mirror: project.views.mirror },
    worldHeight: project.export.worldHeight,
    animations: collected.animations,
    frames: collected.frames,
    options: sel.options,
  }
}

export function encodeBundle(manifest: BundleManifest, buffers: Uint8ClampedArray[], canvas: number): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(manifest))
  const stride = canvas * canvas * 4
  const out = new Uint8Array(4 + json.length + buffers.length * stride)
  new DataView(out.buffer).setUint32(0, json.length, true)
  out.set(json, 4)
  let off = 4 + json.length
  for (const b of buffers) {
    if (b.length !== stride) throw new Error(`frame buffer has ${b.length} bytes, expected ${stride}`)
    out.set(b, off)
    off += stride
  }
  return out
}

/** Parse a bundle back (tests and the browser fallback). */
export function decodeBundle(bytes: Uint8Array): { manifest: BundleManifest; buffers: Uint8Array[] } {
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + len))) as BundleManifest
  const stride = manifest.canvas * manifest.canvas * 4
  const buffers: Uint8Array[] = []
  for (let off = 4 + len; off + stride <= bytes.length; off += stride) buffers.push(bytes.subarray(off, off + stride))
  return { manifest, buffers }
}
