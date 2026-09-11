import { describe, it, expect } from 'vitest'
import { apply3, axisAngle, composeAffine, eulerFromMatrix, eulerMatrix, projectPoint, unprojectPoint, viewAxes, affine, applyAffine, mul3, transpose3 } from '../../domain/math3'

const vp = (view: number, N = 8, elevationDeg = 0) => ({ N, view, size: 64, elevationDeg })

describe('math3', () => {
  it('projects the character frame the way the views are defined', () => {
    // feet point → bottom centre
    expect(projectPoint({ r: 0, u: 0, f: 0 }, vp(1))).toMatchObject({ x: 32, y: 64 })
    // the character's right is on screen-left in the front view, screen-right from behind
    expect(projectPoint({ r: 10, u: 0, f: 0 }, vp(1)).x).toBeCloseTo(22)
    expect(projectPoint({ r: 10, u: 0, f: 0 }, vp(5)).x).toBeCloseTo(42)
    // forward points at the camera in view 1 (depth +), away in view 5
    expect(projectPoint({ r: 0, u: 0, f: 10 }, vp(1)).depth).toBeCloseTo(10)
    expect(projectPoint({ r: 0, u: 0, f: 10 }, vp(5)).depth).toBeCloseTo(-10)
    // in view 3 (camera at the character's left) forward appears on screen-left
    expect(projectPoint({ r: 0, u: 0, f: 10 }, vp(3)).x).toBeCloseTo(22)
    // up is up
    expect(projectPoint({ r: 0, u: 10, f: 0 }, vp(2)).y).toBeCloseTo(54)
  })

  it('unproject inverts project at a given depth, with and without elevation', () => {
    for (const view of [1, 2, 3, 6]) {
      for (const el of [0, 25]) {
        const v = vp(view, 8, el)
        const p = { r: 7, u: 13, f: -4 }
        const q = projectPoint(p, v)
        const back = unprojectPoint(q.x, q.y, q.depth, v)
        expect(back.r).toBeCloseTo(p.r)
        expect(back.u).toBeCloseTo(p.u)
        expect(back.f).toBeCloseTo(p.f)
      }
    }
  })

  it('view axes are orthonormal and match the projection', () => {
    const v = vp(2, 8, 20)
    const { right, up, toward } = viewAxes(v)
    const dot = (a: typeof right, b: typeof right) => a.r * b.r + a.u * b.u + a.f * b.f
    expect(dot(right, up)).toBeCloseTo(0)
    expect(dot(right, toward)).toBeCloseTo(0)
    expect(dot(up, toward)).toBeCloseTo(0)
    const o = projectPoint({ r: 0, u: 0, f: 0 }, v)
    const pr = projectPoint(right, v)
    expect(pr.x - o.x).toBeCloseTo(1)
    expect(pr.y - o.y).toBeCloseTo(0)
    const pu = projectPoint(up, v)
    expect(pu.y - o.y).toBeCloseTo(-1)
    const pt = projectPoint(toward, v)
    expect(pt.depth - o.depth).toBeCloseTo(1)
  })

  it('euler matrices round-trip and roll about forward turns in the front view plane', () => {
    for (const e of [{ r: 10, u: -40, f: 75 }, { r: -60, u: 120, f: -15 }, { r: 0, u: 0, f: 90 }]) {
      const m = eulerMatrix(e)
      const back = eulerFromMatrix(m)
      expect(back.r).toBeCloseTo(e.r, 4)
      expect(back.u).toBeCloseTo(e.u, 4)
      expect(back.f).toBeCloseTo(e.f, 4)
    }
    // a bone points up; roll −90 about forward makes it point along −r = screen-right in view 1
    const tip = apply3(eulerMatrix({ r: 0, u: 0, f: -90 }), { r: 0, u: 10, f: 0 })
    expect(tip.r).toBeCloseTo(-10)
    expect(tip.u).toBeCloseTo(0)
    expect(projectPoint(tip, vp(1)).x).toBeCloseTo(42)
  })

  it('axis-angle about the camera axis rotates CCW on screen', () => {
    const v = vp(1)
    const { toward } = viewAxes(v)
    const m = axisAngle(toward, 90)
    const p = apply3(m, { r: -10, u: 0, f: 0 }) // screen-right in view 1
    expect(projectPoint(p, v).y).toBeCloseTo(64 - 10) // now pointing up
    expect(mul3(transpose3(m), m).map(x => Math.round(x * 1e6) / 1e6)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
  })

  it('affine composition applies the right operand first', () => {
    const a = affine(eulerMatrix({ r: 0, u: 90, f: 0 }), { r: 1, u: 2, f: 3 })
    const b = affine(eulerMatrix({ r: 0, u: 0, f: 0 }), { r: 0, u: 5, f: 0 })
    const p = applyAffine(composeAffine(a, b), { r: 0, u: 0, f: 0 })
    const q = applyAffine(a, applyAffine(b, { r: 0, u: 0, f: 0 }))
    expect(p).toEqual(q)
    expect(p.u).toBeCloseTo(7)
  })
})
