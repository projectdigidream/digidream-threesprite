import { describe, it, expect } from 'vitest'
import { bearingTurns, billboardYaw, facingDirection, orbitPosition, screenFacingToward, screenFacingX } from '../../core/preview/rotation'
import { viewIndex } from '../../domain/views'

describe('preview rotation maths', () => {
  it('facingDirection goes anticlockwise seen from above (from +X towards −Z)', () => {
    expect(facingDirection(0)).toMatchObject({ x: 1, z: expect.closeTo(0, 9) })
    const q = facingDirection(0.25)
    expect(q.x).toBeCloseTo(0)
    expect(q.z).toBeCloseTo(-1)
  })

  it('bearingTurns inverts facingDirection', () => {
    for (let t = 0; t < 1; t += 0.05) {
      const d = facingDirection(t)
      const b = ((bearingTurns(0, 0, d.x * 3, d.z * 3) % 1) + 1) % 1
      expect(b).toBeCloseTo(t % 1, 6)
    }
  })

  it('a camera orbiting the character picks the views in order', () => {
    const facing = 0.125
    for (let k = 1; k <= 8; k++) {
      const cam = orbitPosition(0, 0, facing + (k - 1) / 8, 5, 1)
      expect(viewIndex(8, facing, bearingTurns(0, 0, cam.x, cam.z))).toBe(k)
    }
  })

  it('screen-facing components at the cardinal views', () => {
    expect(screenFacingToward(0)).toBeCloseTo(1) // front: faces the viewer
    expect(screenFacingX(0.25)).toBeCloseTo(-1) // camera at its left: faces screen-left
    expect(screenFacingToward(0.5)).toBeCloseTo(-1) // back
    expect(screenFacingX(0.75)).toBeCloseTo(1) // right
  })

  it('billboardYaw points a +Z plane at the camera', () => {
    expect(billboardYaw(0, 5, 0, 0)).toBeCloseTo(0)
    expect(billboardYaw(5, 0, 0, 0)).toBeCloseTo(Math.PI / 2)
  })
})
