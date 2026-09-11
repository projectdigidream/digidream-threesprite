import { describe, it, expect } from 'vitest'
import { apply, compose, invert, mul, nearlyEqual, rotate, rotationOf, scale, translate, IDENTITY } from '../../domain/transform'

describe('transform', () => {
  it('rotate(90) is counter-clockwise on a y-down screen', () => {
    const p = apply(rotate(90), 1, 0)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(-1) // up on screen
  })

  it('mul applies the right operand first', () => {
    const m = mul(translate(10, 0), rotate(90))
    const p = apply(m, 1, 0)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(-1)
    const m2 = mul(rotate(90), translate(10, 0))
    const q = apply(m2, 1, 0) // translate first: (11, 0) → rotate: (0, -11)
    expect(q.x).toBeCloseTo(0)
    expect(q.y).toBeCloseTo(-11)
  })

  it('compose chains left to right with the last applied first', () => {
    const a = compose(translate(1, 2), rotate(45), scale(2, 3))
    const b = mul(mul(translate(1, 2), rotate(45)), scale(2, 3))
    expect(nearlyEqual(a, b)).toBe(true)
  })

  it('invert undoes the matrix', () => {
    const m = compose(translate(5, -3), rotate(33), scale(2, 0.5))
    const inv = invert(m)!
    expect(nearlyEqual(mul(m, inv), IDENTITY)).toBe(true)
    expect(nearlyEqual(mul(inv, m), IDENTITY)).toBe(true)
  })

  it('invert returns null for a singular matrix', () => {
    expect(invert(scale(0, 1))).toBeNull()
  })

  it('rotationOf recovers the angle', () => {
    expect(rotationOf(rotate(30))).toBeCloseTo(30)
    expect(rotationOf(compose(translate(3, 4), rotate(-120)))).toBeCloseTo(-120)
  })
})
