/**
 * 3D maths for the character frame (x = r, y = u, z = f) and the per-view
 * orthographic projection shared by bones and solids.
 */
import type { Vec3 } from './types'

/** Row-major 3×3. */
export type Mat3 = number[]
/** Affine transform: p' = m·p + t. */
export interface Mat34 { m: Mat3; t: Vec3 }

export const IDENTITY3: Readonly<Mat3> = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1])
const D2R = Math.PI / 180

export const vec3 = (r: number, u: number, f: number): Vec3 => ({ r, u, f })
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ r: a.r + b.r, u: a.u + b.u, f: a.f + b.f })
export const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ r: a.r - b.r, u: a.u - b.u, f: a.f - b.f })
export const scale3 = (a: Vec3, k: number): Vec3 => ({ r: a.r * k, u: a.u * k, f: a.f * k })
export const dot3 = (a: Vec3, b: Vec3): number => a.r * b.r + a.u * b.u + a.f * b.f
export const length3 = (a: Vec3): number => Math.hypot(a.r, a.u, a.f)
export const cross3 = (a: Vec3, b: Vec3): Vec3 => ({ r: a.u * b.f - a.f * b.u, u: a.f * b.r - a.r * b.f, f: a.r * b.u - a.u * b.r })
export function normalize3(a: Vec3): Vec3 {
  const l = length3(a) || 1
  return { r: a.r / l, u: a.u / l, f: a.f / l }
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  return o
}

export const transpose3 = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]

export function apply3(m: Mat3, v: Vec3): Vec3 {
  return { r: m[0] * v.r + m[1] * v.u + m[2] * v.f, u: m[3] * v.r + m[4] * v.u + m[5] * v.f, f: m[6] * v.r + m[7] * v.u + m[8] * v.f }
}

export function scaleMatrix(s: Vec3): Mat3 {
  return [s.r, 0, 0, 0, s.u, 0, 0, 0, s.f]
}

/**
 * Ry(yaw = rot.u) · Rx(pitch = rot.r) · Rz(roll = rot.f), degrees.
 *
 * The (r, u, f) triple is a left-handed frame in the physical world (right ×
 * up = −forward), so the angles are negated inside to keep rotations
 * physically right-handed: positive yaw turns anticlockwise seen from above,
 * positive roll turns counter-clockwise on screen in the front view.
 */
export function eulerMatrix(rot: Vec3): Mat3 {
  const cy = Math.cos(-rot.u * D2R), sy = Math.sin(-rot.u * D2R)
  const cp = Math.cos(-rot.r * D2R), sp = Math.sin(-rot.r * D2R)
  const cr = Math.cos(-rot.f * D2R), sr = Math.sin(-rot.f * D2R)
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp]
  const rz = [cr, -sr, 0, sr, cr, 0, 0, 0, 1]
  return mul3(mul3(ry, rx), rz)
}

/** Inverse of `eulerMatrix` for a pure rotation (YXZ order). */
export function eulerFromMatrix(m: Mat3): Vec3 {
  const sp = -m[5]
  const pitch = Math.asin(Math.max(-1, Math.min(1, sp)))
  const cp = Math.cos(pitch)
  let yaw: number
  let roll: number
  if (Math.abs(cp) > 1e-6) {
    yaw = Math.atan2(m[2], m[8])
    roll = Math.atan2(m[3], m[4])
  } else {
    roll = 0
    yaw = Math.atan2(-m[6], m[0])
  }
  return { u: -yaw / D2R, r: -pitch / D2R, f: -roll / D2R }
}

/** Rotation about a unit axis by `deg` (Rodrigues), physically right-handed like `eulerMatrix`. */
export function axisAngle(axis: Vec3, deg: number): Mat3 {
  const a = normalize3(axis)
  const c = Math.cos(-deg * D2R), s = Math.sin(-deg * D2R), t = 1 - c
  const { r: x, u: y, f: z } = a
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ]
}

export const affine = (m: Mat3, t: Vec3): Mat34 => ({ m, t })
export const IDENTITY34: Readonly<Mat34> = Object.freeze({ m: IDENTITY3 as Mat3, t: { r: 0, u: 0, f: 0 } })

/** a · b: apply b first, then a. */
export function composeAffine(a: Mat34, b: Mat34): Mat34 {
  return { m: mul3(a.m, b.m), t: add3(apply3(a.m, b.t), a.t) }
}

export function applyAffine(a: Mat34, v: Vec3): Vec3 {
  return add3(apply3(a.m, v), a.t)
}

/** Inverse of a 3×3 matrix, or null when singular. */
export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const k = 1 / det
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ]
}

/** Inverse of an affine, or null when its linear part is singular. */
export function invertAffine(a: Mat34): Mat34 | null {
  const inv = invert3(a.m)
  if (!inv) return null
  return { m: inv, t: scale3(apply3(inv, a.t), -1) }
}

/** Rotation part of an affine, orthonormalised (drops scale). */
export function rotationOf3(a: Mat34): Mat3 {
  const x = normalize3({ r: a.m[0], u: a.m[3], f: a.m[6] })
  let y = { r: a.m[1], u: a.m[4], f: a.m[7] }
  y = normalize3(sub3(y, scale3(x, dot3(x, y))))
  const z = cross3(x, y)
  return [x.r, y.r, z.r, x.u, y.u, z.u, x.f, y.f, z.f]
}

// ── view projection ──────────────────────────────────────────────────────────

export interface ViewProj {
  N: number
  view: number
  size: number
  /** Camera elevation above the horizon, degrees. */
  elevationDeg: number
  /**
   * How strongly travel towards the camera grows a thing: the size change a
   * full canvas height of travel is worth. 0 or absent = flat, nothing
   * changes size with depth.
   */
  depthStrength?: number
}

export interface Projected { x: number; y: number; depth: number }

function trig(vp: ViewProj) {
  const rel = (vp.view - 1) / vp.N
  return { c: Math.cos(2 * Math.PI * rel), s: Math.sin(2 * Math.PI * rel), cp: Math.cos(vp.elevationDeg * D2R), sp: Math.sin(vp.elevationDeg * D2R) }
}

/** Character-frame point → canvas pixel coordinates (y-down) and depth towards the camera. */
export function projectPoint(p: Vec3, vp: ViewProj): Projected {
  const { c, s, cp, sp } = trig(vp)
  const sx = -p.f * s - p.r * c
  const sy = p.u
  const d = p.f * c - p.r * s
  return { x: vp.size / 2 + sx, y: vp.size - (sy * cp - d * sp), depth: sy * sp + d * cp }
}

/** The narrowest and widest a depth change may squeeze or stretch something. */
export const DEPTH_SCALE_MIN = 0.25
export const DEPTH_SCALE_MAX = 4

/**
 * How much bigger something at `curDepth` looks than the same thing at
 * `restDepth`: a perspective divide over the distance travelled towards the
 * camera, measured in canvas heights and scaled by `vp.depthStrength`.
 *
 * It is the travel that counts, not where the thing sits, so the rest pose is
 * always exactly 1 and the whole rig stays predictable. Strength 1 is about
 * what a camera one canvas height away would do; sprites move so little in
 * depth that anything readable wants more, which is why this is a strength
 * and not a camera distance.
 */
export function depthFactor(restDepth: number, curDepth: number, vp: ViewProj): number {
  const s = vp.depthStrength ?? 0
  if (!(s > 0)) return 1
  const travel = (s * (curDepth - restDepth)) / vp.size
  if (travel >= 1) return DEPTH_SCALE_MAX // past the lens: hold it at the limit
  return Math.max(DEPTH_SCALE_MIN, Math.min(DEPTH_SCALE_MAX, 1 / (1 - travel)))
}

/** Canvas point at a given depth → character-frame point (inverse of `projectPoint`). */
export function unprojectPoint(x: number, y: number, depth: number, vp: ViewProj): Vec3 {
  const { c, s, cp, sp } = trig(vp)
  const sx = x - vp.size / 2
  const yUp = vp.size - y
  const sy = yUp * cp + depth * sp
  const d = -yUp * sp + depth * cp
  return { r: -sx * c - d * s, u: sy, f: -sx * s + d * c }
}

/** Unit character-frame directions of screen-right, screen-up and "towards the camera" for a view. */
export function viewAxes(vp: ViewProj): { right: Vec3; up: Vec3; toward: Vec3 } {
  const { c, s, cp, sp } = trig(vp)
  return {
    right: { r: -c, u: 0, f: -s },
    up: { r: s * sp, u: cp, f: -c * sp },
    toward: { r: -s * cp, u: sp, f: c * cp },
  }
}

/** A direction's on-screen angle (degrees, CCW on screen) and projected length. */
export function projectedAngle(from: Projected, to: Projected): { angle: number; length: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return { angle: (-Math.atan2(dy, dx) * 180) / Math.PI, length: Math.hypot(dx, dy) }
}
