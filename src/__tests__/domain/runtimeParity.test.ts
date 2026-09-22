/**
 * The engine runtime in `runtime/` reimplements the rules a player needs, with
 * no dependency on the editor. These tests pin the two together: if the view
 * selection, the frame clock or the ground bearing ever drift apart, a sprite
 * would face the wrong way in the game while looking right in the studio.
 */
import { describe, it, expect } from 'vitest'
import { relativeTurns, turnsFromGround, viewAngleTurns as runtimeViewAngle, viewFor } from '../../../runtime/src/angles'
import { frameAt as runtimeFrameAt } from '../../../runtime/src/playback'
import { frameAt } from '../../domain/animation'
import { bearingTurns } from '../../core/preview/rotation'
import { viewAngleDeg, viewAngleTurns, viewIndex } from '../../domain/views'

/** A spread of awkward angles: negatives, several turns out, and exact boundaries. */
function angles(count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push((i * 0.073) - 2.5)
  return out.concat([0, 0.25, 0.5, 0.75, 1, -1, 3.5, 0.125, 0.0625])
}

describe('the engine runtime agrees with the editor', () => {
  it('picks the same view for every count, facing and bearing', () => {
    for (let n = 1; n <= 64; n++) {
      for (const facing of angles(17)) {
        for (const bearing of angles(13)) {
          expect(viewFor(n, relativeTurns(bearing, facing)), `${n} views, facing ${facing}, bearing ${bearing}`)
            .toBe(viewIndex(n, facing, bearing))
        }
      }
    }
  })

  it('places each view at the same angle, which is what the atlas manifest writes', () => {
    for (const n of [1, 4, 6, 8, 12, 16, 24, 32, 64, 7]) {
      for (let k = 1; k <= n; k++) {
        expect(runtimeViewAngle(n, k)).toBeCloseTo(viewAngleTurns(n, k), 12)
        // the exporter writes (k − 1) · 360 / n into `views.list[].angleDeg`
        expect(runtimeViewAngle(n, k) * 360).toBeCloseTo(viewAngleDeg(n, k), 10)
      }
    }
  })

  it('shows the same frame at the same moment', () => {
    for (const fps of [0, 1, 8, 10, 12, 24, 50, 60]) {
      for (const frameCount of [1, 2, 3, 7, 28, 256]) {
        for (const loop of [true, false]) {
          for (const t of [-1, 0, 0.001, 0.05, 1 / 3, 1, 2.75, 97.2]) {
            expect(runtimeFrameAt({ fps, frameCount, loop }, t), `fps ${fps}, ${frameCount} frames, loop ${loop}, t ${t}`)
              .toBe(frameAt({ fps, frameCount, loop }, t))
          }
        }
      }
    }
  })

  it('reads the same heading off the ground plane', () => {
    const points = [0, 1, -1, 3.5, -7.25, 0.5]
    for (const ax of points) {
      for (const az of points) {
        for (const bx of points) {
          for (const bz of points) {
            if (ax === bx && az === bz) continue
            const editor = bearingTurns(ax, az, bx, bz)
            const runtime = turnsFromGround(bx - ax, bz - az)
            // the editor returns a signed turn, the runtime wraps to [0, 1)
            expect(((editor % 1) + 1) % 1).toBeCloseTo(runtime, 12)
          }
        }
      }
    }
  })

  it('agrees on the view a camera at a point sees, end to end', () => {
    // a character at the origin facing +x, cameras all round it
    for (const n of [4, 8, 16]) {
      for (let i = 0; i < 32; i++) {
        const turn = i / 32
        const camX = Math.cos(turn * Math.PI * 2) * 10
        const camZ = -Math.sin(turn * Math.PI * 2) * 10
        const facing = 0.3
        const editor = viewIndex(n, facing, bearingTurns(0, 0, camX, camZ))
        const runtime = viewFor(n, relativeTurns(turnsFromGround(camX, camZ), facing))
        expect(runtime, `${n} views, camera at turn ${turn}`).toBe(editor)
      }
    }
  })
})
