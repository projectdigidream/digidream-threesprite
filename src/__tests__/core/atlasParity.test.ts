/**
 * The TypeScript atlas builder against the Rust one.
 *
 * `runtime/test/fixtures/sample-atlas.json` was written by the Rust exporter
 * from a known set of frames (see `atlas_fixture_has_the_shape_the_runtime_parses`
 * in src-tauri/src/atlas.rs). Building the same frames here has to produce the
 * same manifest, byte for byte after formatting, or a sprite exported from the
 * browser would differ from one exported from the desktop app.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildAtlas, nextPow2, pack } from '../../core/export/atlasBuild'
import type { AnimationMeta, FrameRef } from '../../core/export/types'

const CANVAS = 16
const VIEWS = 4
const FRAME_COUNT = 2

/** The same pixels the Rust fixture test builds. */
function fixtureFrames(): { frames: FrameRef[]; buffers: Uint8ClampedArray[] } {
  const frames: FrameRef[] = []
  for (let f = 0; f < FRAME_COUNT; f++) {
    for (let v = 1; v <= VIEWS; v++) frames.push({ anim: 0, frame: f, view: v })
  }
  const count = FRAME_COUNT * VIEWS
  const buffers: Uint8ClampedArray[] = []
  for (let i = 0; i < count; i++) {
    const px = new Uint8ClampedArray(CANVAS * CANVAS * 4)
    if (i + 1 < count) {
      const x0 = i % 5
      const y0 = 2 + (i % 3)
      const w = 4 + (i % 3)
      const h = 5 + (i % 4)
      for (let y = y0; y < Math.min(y0 + h, CANVAS); y++) {
        for (let x = x0; x < Math.min(x0 + w, CANVAS); x++) {
          const o = (y * CANVAS + x) * 4
          px[o] = 200
          px[o + 1] = (40 + i * 10) & 255
          px[o + 2] = 90
          px[o + 3] = 255
        }
      }
    }
    buffers.push(px)
  }
  return { frames, buffers }
}

const animations: AnimationMeta[] = [{ name: 'walk', fps: 10, loop: true, frameCount: FRAME_COUNT }]

describe('the TypeScript atlas matches the Rust exporter', () => {
  const { frames, buffers } = fixtureFrames()
  const built = buildAtlas({
    sprite: 'HERO',
    canvas: CANVAS,
    views: { count: VIEWS, mirror: true },
    worldHeight: 1.75,
    animations,
    frames,
    buffers,
    pow2: false,
  })
  // vitest runs from the repo root; jsdom leaves import.meta.url non-file
  const fromRust = JSON.parse(readFileSync('runtime/test/fixtures/sample-atlas.json', 'utf8'))

  it('produces the same manifest', () => {
    expect(built.manifest).toEqual(fromRust)
  })

  it('packs to the same sheet size', () => {
    expect({ w: built.width, h: built.height }).toEqual(fromRust.size)
  })

  it('reports the empty frame the same way', () => {
    expect(built.warnings).toEqual(['walk: frame 2 view 4 is empty'])
  })

  it('writes a PNG of that size', () => {
    expect(built.png.length).toBeGreaterThan(50)
    expect(Array.from(built.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  })
})

describe('the packer', () => {
  it('rounds up to powers of two', () => {
    expect(nextPow2(1)).toBe(1)
    expect(nextPow2(5)).toBe(8)
    expect(nextPow2(64)).toBe(64)
  })

  it('never overlaps and always fits, as the Rust test asserts', () => {
    const sizes: [number, number][] = Array.from({ length: 40 }, (_, i) => [3 + (i * 7) % 20, 2 + (i * 5) % 17])
    const { pos, width, height } = pack(sizes, 1, true)
    expect(Number.isInteger(Math.log2(height))).toBe(true)
    for (let i = 0; i < sizes.length; i++) {
      const [x, y] = pos[i]
      expect(x + sizes[i][0], `item ${i} fits across`).toBeLessThanOrEqual(width)
      expect(y + sizes[i][1], `item ${i} fits down`).toBeLessThanOrEqual(height)
      for (let j = 0; j < i; j++) {
        const [xj, yj] = pos[j]
        const apart =
          x + sizes[i][0] <= xj || xj + sizes[j][0] <= x ||
          y + sizes[i][1] <= yj || yj + sizes[j][1] <= y
        expect(apart, `items ${i} and ${j} overlap`).toBe(true)
      }
    }
  })

  it('handles an empty sheet', () => {
    expect(pack([], 1, false)).toEqual({ pos: [], width: 1, height: 1 })
  })
})
