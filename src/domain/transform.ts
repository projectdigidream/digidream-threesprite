/**
 * 2D affine matrices in the form
 *   x' = a·x + c·y + tx
 *   y' = b·x + d·y + ty
 * (column-vector convention, y-down canvas space).
 */
export interface Mat2D {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

export const IDENTITY: Readonly<Mat2D> = Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })

export function translate(x: number, y: number): Mat2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y }
}

/** Rotation by `deg`, positive = counter-clockwise as seen on a y-down screen. */
export function rotate(deg: number): Mat2D {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { a: cos, b: -sin, c: sin, d: cos, tx: 0, ty: 0 }
}

export function scale(sx: number, sy: number): Mat2D {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 }
}

/** p · q — apply `q` first, then `p`. */
export function mul(p: Mat2D, q: Mat2D): Mat2D {
  return {
    a: p.a * q.a + p.c * q.b,
    b: p.b * q.a + p.d * q.b,
    c: p.a * q.c + p.c * q.d,
    d: p.b * q.c + p.d * q.d,
    tx: p.a * q.tx + p.c * q.ty + p.tx,
    ty: p.b * q.tx + p.d * q.ty + p.ty,
  }
}

/** Left-to-right composition: compose(A, B, C) = A · B · C (C applied first). */
export function compose(...ms: Mat2D[]): Mat2D {
  let m: Mat2D = { ...IDENTITY }
  for (const n of ms) m = mul(m, n)
  return m
}

/** Inverse, or null when the matrix is singular (a zero scale). */
export function invert(m: Mat2D): Mat2D | null {
  const det = m.a * m.d - m.b * m.c
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const ia = m.d / det
  const ib = -m.b / det
  const ic = -m.c / det
  const id = m.a / det
  return {
    a: ia,
    b: ib,
    c: ic,
    d: id,
    tx: -(ia * m.tx + ic * m.ty),
    ty: -(ib * m.tx + id * m.ty),
  }
}

export function apply(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty }
}

/** Rotation angle of the matrix's x axis, degrees CCW on screen. */
export function rotationOf(m: Mat2D): number {
  return (-Math.atan2(m.b, m.a) * 180) / Math.PI
}

export function nearlyEqual(p: Mat2D, q: Mat2D, eps = 1e-9): boolean {
  return (
    Math.abs(p.a - q.a) < eps &&
    Math.abs(p.b - q.b) < eps &&
    Math.abs(p.c - q.c) < eps &&
    Math.abs(p.d - q.d) < eps &&
    Math.abs(p.tx - q.tx) < eps &&
    Math.abs(p.ty - q.ty) < eps
  )
}
