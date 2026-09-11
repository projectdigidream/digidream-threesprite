/**
 * Multi-bone deformation of a pixel part ("skinning"), in the plane of a
 * view. The part image is cut into a grid; each grid vertex gets weights from
 * its distance to the influencing bones' projected rest segments; at a frame
 * the vertex moves to the weighted blend of each bone's rigid motion
 * (current projected frame × inverse rest frame). The deformed grid is drawn
 * as textured triangles with nearest sampling, so the art stays crisp.
 */
import type { BoneProjection } from './pose'
import { apply, compose, invert, rotate, scale, translate, type Mat2D } from './transform'
import type { PartImage } from './types'

export interface SkinGrid {
  cols: number
  rows: number
  /** Image-pixel coordinates per vertex, (u, v) pairs. */
  uv: Float32Array
  /** Rest canvas positions per vertex, (x, y) pairs. */
  rest: Float32Array
  /** Weights per vertex × bone, row-major [vertex][bone]. */
  weights: Float32Array
}

/** T(origin) · R(angle) · S(foreshorten, 1): a bone's projected 2D frame. */
export function boneFrame(bp: BoneProjection, fs = 1): Mat2D {
  return compose(translate(bp.origin.x, bp.origin.y), rotate(bp.angle), scale(fs, 1))
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Compact-support falloff: 1 on the bone, 0 at `falloff` px and beyond. */
export function influence(d: number, falloff: number): number {
  const t = 1 - d / Math.max(1e-6, falloff)
  return t > 0 ? t * t : 0
}

/**
 * Build the grid for an image placed by `restMatrix` (image px → canvas),
 * weighting each vertex against the bones' rest projections in this view.
 */
export function buildSkinGrid(img: PartImage, restMatrix: Mat2D, boneRests: BoneProjection[], falloff: number, cell: number): SkinGrid {
  const c = Math.max(1, Math.round(cell))
  const cols = Math.max(1, Math.ceil(img.width / c))
  const rows = Math.max(1, Math.ceil(img.height / c))
  const nv = (cols + 1) * (rows + 1)
  const nb = boneRests.length
  const uv = new Float32Array(nv * 2)
  const rest = new Float32Array(nv * 2)
  const weights = new Float32Array(nv * nb)
  let k = 0
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++, k++) {
      const u = Math.min(img.width, i * c)
      const v = Math.min(img.height, j * c)
      uv[k * 2] = u
      uv[k * 2 + 1] = v
      const p = apply(restMatrix, u, v)
      rest[k * 2] = p.x
      rest[k * 2 + 1] = p.y
      let sum = 0
      let nearest = 0
      let nearestD = Infinity
      for (let b = 0; b < nb; b++) {
        const br = boneRests[b]
        const d = distToSegment(p.x, p.y, br.origin.x, br.origin.y, br.tip.x, br.tip.y)
        const w = influence(d, falloff)
        weights[k * nb + b] = w
        sum += w
        if (d < nearestD) { nearestD = d; nearest = b }
      }
      if (sum <= 0) {
        weights[k * nb + nearest] = 1
      } else {
        for (let b = 0; b < nb; b++) weights[k * nb + b] /= sum
      }
    }
  }
  return { cols, rows, uv, rest, weights }
}

/** Deformed canvas positions: Σ w_b · (cur_b · rest_b⁻¹) · restPos. */
export function deformGrid(grid: SkinGrid, boneRests: BoneProjection[], boneCurs: BoneProjection[], foreshorten: boolean): Float32Array {
  const nb = boneRests.length
  const deltas: Mat2D[] = []
  for (let b = 0; b < nb; b++) {
    const r = boneRests[b]
    const cu = boneCurs[b]
    const fs = foreshorten && r.length >= 0.5 ? Math.max(0.15, Math.min(4, cu.length / r.length)) : 1
    const angle = cu.length < 0.5 ? r.angle : cu.angle
    const curFrame = compose(translate(cu.origin.x, cu.origin.y), rotate(angle), scale(fs, 1))
    const inv = invert(boneFrame(r, 1))
    deltas.push(inv ? compose(curFrame, inv) : { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 })
  }
  const nv = grid.rest.length / 2
  const out = new Float32Array(nv * 2)
  for (let k = 0; k < nv; k++) {
    const x = grid.rest[k * 2], y = grid.rest[k * 2 + 1]
    let ox = 0, oy = 0
    for (let b = 0; b < nb; b++) {
      const w = grid.weights[k * nb + b]
      if (w === 0) continue
      const m = deltas[b]
      ox += w * (m.a * x + m.c * y + m.tx)
      oy += w * (m.b * x + m.d * y + m.ty)
    }
    out[k * 2] = ox
    out[k * 2 + 1] = oy
  }
  return out
}

/** True when no vertex moved (the rest pose): the caller can use the exact rigid blit instead. */
export function gridIsAtRest(grid: SkinGrid, pos: Float32Array, eps = 1e-6): boolean {
  for (let i = 0; i < pos.length; i++) if (Math.abs(pos[i] - grid.rest[i]) > eps) return false
  return true
}

/**
 * Draw the deformed grid: each cell as two textured triangles, nearest
 * sampling, straight-alpha source-over. A per-part coverage mask keeps
 * shared edges from blending twice.
 */
export function rasterizeSkinnedGrid(dst: Uint8ClampedArray, dw: number, dh: number, img: PartImage, grid: SkinGrid, pos: Float32Array, alphaMul = 1): void {
  const covered = new Uint8Array(dw * dh)
  const stride = grid.cols + 1
  for (let j = 0; j < grid.rows; j++) {
    for (let i = 0; i < grid.cols; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1
      tri(a, b, d)
      tri(a, d, c)
    }
  }

  function tri(i0: number, i1: number, i2: number) {
    const x0 = pos[i0 * 2], y0 = pos[i0 * 2 + 1], u0 = grid.uv[i0 * 2], v0 = grid.uv[i0 * 2 + 1]
    const x1 = pos[i1 * 2], y1 = pos[i1 * 2 + 1], u1 = grid.uv[i1 * 2], v1 = grid.uv[i1 * 2 + 1]
    const x2 = pos[i2 * 2], y2 = pos[i2 * 2 + 1], u2 = grid.uv[i2 * 2], v2 = grid.uv[i2 * 2 + 1]
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    if (Math.abs(area) < 1e-9) return
    const inv = 1 / area
    const bx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const bx1 = Math.min(dw - 1, Math.ceil(Math.max(x0, x1, x2)))
    const by0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const by1 = Math.min(dh - 1, Math.ceil(Math.max(y0, y1, y2)))
    const sw = img.width, sh = img.height, sp = img.pixels
    for (let y = by0; y <= by1; y++) {
      const py = y + 0.5
      for (let x = bx0; x <= bx1; x++) {
        const idx = y * dw + x
        if (covered[idx]) continue
        const px = x + 0.5
        let w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv
        let w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv
        let w2 = 1 - w0 - w1
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
        w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2)
        const u = u0 * w0 + u1 * w1 + u2 * w2
        const v = v0 * w0 + v1 * w1 + v2 * w2
        const si = Math.min(sw - 1, Math.max(0, Math.floor(u)))
        const sj = Math.min(sh - 1, Math.max(0, Math.floor(v)))
        const s = (sj * sw + si) * 4
        let sa = sp[s + 3]
        if (sa === 0) continue
        covered[idx] = 1
        if (alphaMul !== 1) sa *= alphaMul
        const o = idx * 4
        if (sa >= 255) { dst[o] = sp[s]; dst[o + 1] = sp[s + 1]; dst[o + 2] = sp[s + 2]; dst[o + 3] = 255; continue }
        const a = sa / 255
        const da = dst[o + 3] / 255
        const outA = a + da * (1 - a)
        if (outA <= 0) continue
        const wS = a / outA, wD = (da * (1 - a)) / outA
        dst[o] = sp[s] * wS + dst[o] * wD
        dst[o + 1] = sp[s + 1] * wS + dst[o + 1] * wD
        dst[o + 2] = sp[s + 2] * wS + dst[o + 2] * wD
        dst[o + 3] = outA * 255
      }
    }
  }
}
