/**
 * 3D primitives ("solids") rendered into a view. A solids group belongs to a
 * part and lives in that part's bone frame, so it moves with the rig in 3D;
 * every view renders the same scene from its own bearing, with a shared
 * depth buffer per view for correct occlusion, quantised pixel-art shading
 * and an optional outline.
 */
import { newId } from './ids'
import { createImage } from './image'
import { apply3, applyAffine, depthScale, dot3, eulerMatrix, mul3, normalize3, projectPoint, rotationOf3, viewAxes, type Mat34, type ViewProj } from './math3'
import type { PartImage, Primitive, PrimitiveKind, RGBA, SolidsGroup, SolidsShading } from './types'

export const PRIMITIVE_KINDS: PrimitiveKind[] = ['cube', 'sphere', 'cylinder', 'cone', 'pyramid']

export const DEFAULT_SHADING: SolidsShading = { levels: 3, outline: true, lightSpace: 'view' }

export function createSolidsGroup(): SolidsGroup {
  return { primitives: {}, order: [], shading: { ...DEFAULT_SHADING } }
}

export function createPrimitive(kind: PrimitiveKind, color: RGBA, size = 16, name?: string): Primitive {
  return {
    id: newId(),
    name: name ?? kind,
    kind,
    position: { r: 0, u: size / 2, f: 0 },
    size: { r: size, u: size, f: size },
    rotation: { r: 0, u: 0, f: 0 },
    color: [color[0], color[1], color[2], 255],
    visible: true,
  }
}

// ── unit meshes ──────────────────────────────────────────────────────────────

export interface Mesh {
  /** xyz triples in model space, extents ±0.5 (x = r, y = u, z = f). */
  positions: Float32Array
  /** Per-vertex unit normals. */
  normals: Float32Array
  /** Triangle vertex indices. */
  indices: Uint16Array
}

const meshCache = new Map<PrimitiveKind, Mesh>()

export function unitMesh(kind: PrimitiveKind): Mesh {
  let m = meshCache.get(kind)
  if (!m) {
    m = buildMesh(kind)
    meshCache.set(kind, m)
  }
  return m
}

interface Builder { pos: number[]; nor: number[]; idx: number[] }

function norm(v: number[]): number[] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function faceNormal(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  return norm([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx])
}

function flatTri(b: Builder, a: number[], c: number[], d: number[], n?: number[]): void {
  const nn = n ?? faceNormal(a, c, d)
  smoothTri(b, a, c, d, nn, nn, nn)
}

function smoothTri(b: Builder, a: number[], c: number[], d: number[], na: number[], nc: number[], nd: number[]): void {
  const base = b.pos.length / 3
  for (const [p, n] of [[a, na], [c, nc], [d, nd]] as const) { b.pos.push(p[0], p[1], p[2]); b.nor.push(n[0], n[1], n[2]) }
  b.idx.push(base, base + 1, base + 2)
}

function buildMesh(kind: PrimitiveKind): Mesh {
  const b: Builder = { pos: [], nor: [], idx: [] }
  const h = 0.5
  switch (kind) {
    case 'cube': {
      const faces: number[][][] = [
        [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]],       // +z (front)
        [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]],   // −z
        [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]],       // +x
        [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]],   // −x
        [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]],       // +y (top)
        [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]],   // −y
      ]
      for (const [a, c, d, e] of faces) { flatTri(b, a, c, d); flatTri(b, a, d, e) }
      break
    }
    case 'pyramid': {
      const apex = [0, h, 0]
      const base = [[-h, -h, h], [h, -h, h], [h, -h, -h], [-h, -h, -h]]
      for (let i = 0; i < 4; i++) flatTri(b, base[i], base[(i + 1) % 4], apex)
      flatTri(b, base[0], base[3], base[2]); flatTri(b, base[0], base[2], base[1])
      break
    }
    case 'sphere': {
      const lat = 12, lon = 20
      const v = (i: number, j: number) => {
        const th = (i / lat) * Math.PI, ph = (j / lon) * Math.PI * 2
        return [Math.sin(th) * Math.cos(ph) * h, Math.cos(th) * h, Math.sin(th) * Math.sin(ph) * h]
      }
      for (let i = 0; i < lat; i++) {
        for (let j = 0; j < lon; j++) {
          const a = v(i, j), c = v(i + 1, j), d = v(i + 1, j + 1), e = v(i, j + 1)
          if (i > 0) smoothTri(b, a, c, d, norm(a), norm(c), norm(d))
          if (i < lat - 1) smoothTri(b, a, d, e, norm(a), norm(d), norm(e))
        }
      }
      break
    }
    case 'cylinder':
    case 'cone': {
      const seg = 24
      const top = kind === 'cone' ? 0 : h
      const tilt = kind === 'cone' ? 0.5 : 0
      for (let j = 0; j < seg; j++) {
        const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2
        const p0 = [Math.cos(a0) * h, -h, Math.sin(a0) * h], p1 = [Math.cos(a1) * h, -h, Math.sin(a1) * h]
        const q0 = [Math.cos(a0) * top, h, Math.sin(a0) * top], q1 = [Math.cos(a1) * top, h, Math.sin(a1) * top]
        const n0 = norm([Math.cos(a0), tilt, Math.sin(a0)]), n1 = norm([Math.cos(a1), tilt, Math.sin(a1)])
        if (kind === 'cone') {
          smoothTri(b, p0, [0, h, 0], p1, n0, norm([Math.cos((a0 + a1) / 2), tilt, Math.sin((a0 + a1) / 2)]), n1)
        } else {
          smoothTri(b, p0, q0, p1, n0, n0, n1)
          smoothTri(b, p1, q0, q1, n1, n0, n1)
        }
        flatTri(b, [0, -h, 0], p1, p0, [0, -1, 0])
        if (kind === 'cylinder') flatTri(b, [0, h, 0], q0, q1, [0, 1, 0])
      }
      break
    }
  }
  return { positions: Float32Array.from(b.pos), normals: Float32Array.from(b.nor), indices: Uint16Array.from(b.idx) }
}

// ── shading ──────────────────────────────────────────────────────────────────

/** Tone table for a base colour: darkest → the base colour. */
export function tones(color: RGBA, levels: number): RGBA[] {
  const out: RGBA[] = []
  for (let i = 0; i < levels; i++) {
    const t = levels === 1 ? 1 : i / (levels - 1)
    const k = 0.45 + t * 0.55
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)))
    out.push([c(color[0]), c(color[1]), c(color[2]), 255])
  }
  return out
}

export function outlineColor(color: RGBA): RGBA {
  return [Math.round(color[0] * 0.25), Math.round(color[1] * 0.25), Math.round(color[2] * 0.25), 255]
}

// ── rendering ────────────────────────────────────────────────────────────────

/**
 * Rasterize a solids group placed by `world` (the owning bone's character-
 * frame affine) into a canvas-sized image for one view. Pure and
 * deterministic.
 *
 * `rest` is the same bone in the rest pose. Given it and a camera distance,
 * every vertex is scaled about the bone's root by how far it travelled
 * towards the camera, so a volume swung forward swells and one swung away
 * shrinks. At rest the two affines agree and the image is untouched.
 */
export function renderSolids(group: SolidsGroup, world: Mat34, vp: ViewProj, rest?: Mat34): PartImage {
  const size = vp.size
  const img = createImage(size, size)
  const zbuf = new Float32Array(size * size).fill(-Infinity)
  const primOf = new Int16Array(size * size).fill(-1)
  const shade = new Float32Array(size * size)
  const axes = viewAxes(vp)
  const worldRot = rotationOf3(world)
  const root = projectPoint(applyAffine(world, { r: 0, u: 0, f: 0 }), vp)
  const persp = rest && (vp.distance ?? 0) > 0 ? { rest, ox: root.x, oy: root.y } : null

  // light in view space (x right, y up, z towards the camera)
  let L = [-0.45, 0.75, 0.55]
  if (group.shading.lightSpace === 'character') {
    const lc = { r: 0.45, u: 0.75, f: 0.55 } // the same light as seen in view 1, fixed to the character
    L = [dot3(lc, axes.right), dot3(lc, axes.up), dot3(lc, axes.toward)]
  }
  const ll = Math.hypot(L[0], L[1], L[2]) || 1
  L = [L[0] / ll, L[1] / ll, L[2] / ll]

  const prims = group.order.map(id => group.primitives[id]).filter((p): p is Primitive => !!p && p.visible)
  prims.forEach((prim, pi) => {
    const mesh = unitMesh(prim.kind)
    const R = eulerMatrix(prim.rotation)
    const NR = mul3(worldRot, R)
    const n = mesh.positions.length / 3
    const vx = new Float32Array(n), vy = new Float32Array(n), vz = new Float32Array(n)
    const nx = new Float32Array(n), ny = new Float32Array(n), nz = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const local = apply3(R, { r: mesh.positions[i * 3] * prim.size.r, u: mesh.positions[i * 3 + 1] * prim.size.u, f: mesh.positions[i * 3 + 2] * prim.size.f })
      const lp = { r: local.r + prim.position.r, u: local.u + prim.position.u, f: local.f + prim.position.f }
      const pr = projectPoint(applyAffine(world, lp), vp)
      let px = pr.x, py = pr.y
      if (persp) {
        const k = depthScale(projectPoint(applyAffine(persp.rest, lp), vp).depth, pr.depth, vp)
        px = persp.ox + (px - persp.ox) * k
        py = persp.oy + (py - persp.oy) * k
      }
      vx[i] = px; vy[i] = py; vz[i] = pr.depth
      const wn = normalize3(apply3(NR, { r: mesh.normals[i * 3], u: mesh.normals[i * 3 + 1], f: mesh.normals[i * 3 + 2] }))
      nx[i] = dot3(wn, axes.right); ny[i] = dot3(wn, axes.up); nz[i] = dot3(wn, axes.toward)
    }
    const idx = mesh.indices
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], q = idx[t + 2]
      const area = (vx[b] - vx[a]) * (vy[q] - vy[a]) - (vx[q] - vx[a]) * (vy[b] - vy[a])
      if (area <= 0) continue // back face: outward winding lands positive after the mirrored, y-down projection
      const inv = 1 / area
      const x0 = Math.max(0, Math.floor(Math.min(vx[a], vx[b], vx[q])))
      const x1 = Math.min(size - 1, Math.ceil(Math.max(vx[a], vx[b], vx[q])))
      const y0 = Math.max(0, Math.floor(Math.min(vy[a], vy[b], vy[q])))
      const y1 = Math.min(size - 1, Math.ceil(Math.max(vy[a], vy[b], vy[q])))
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5
          let w0 = ((vx[b] - px) * (vy[q] - py) - (vx[q] - px) * (vy[b] - py)) * inv
          let w1 = ((vx[q] - px) * (vy[a] - py) - (vx[a] - px) * (vy[q] - py)) * inv
          let w2 = 1 - w0 - w1
          if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
          w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2)
          const z = vz[a] * w0 + vz[b] * w1 + vz[q] * w2
          const i = y * size + x
          if (z <= zbuf[i]) continue
          zbuf[i] = z
          primOf[i] = pi
          const lx = nx[a] * w0 + nx[b] * w1 + nx[q] * w2
          const ly = ny[a] * w0 + ny[b] * w1 + ny[q] * w2
          const lz = nz[a] * w0 + nz[b] * w1 + nz[q] * w2
          const len = Math.hypot(lx, ly, lz) || 1
          shade[i] = Math.max(0, (lx * L[0] + ly * L[1] + lz * L[2]) / len)
        }
      }
    }
  })

  const levels = Math.max(2, Math.min(6, Math.round(group.shading.levels)))
  const toneTables = prims.map(p => tones(p.color, levels))
  const px = img.pixels
  for (let i = 0; i < size * size; i++) {
    const pi = primOf[i]
    if (pi < 0) continue
    const tone = Math.min(levels - 1, Math.floor(shade[i] * levels))
    const col = toneTables[pi][tone]
    px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 255
  }
  if (group.shading.outline && prims.length) {
    const mark = new Uint8Array(size * size)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        const pi = primOf[i]
        if (pi < 0) continue
        const z = zbuf[i]
        const nb = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1]
        for (const j of nb) {
          if (j < 0) continue
          if (primOf[j] < 0 || (primOf[j] !== pi && zbuf[j] < z - 1.5)) { mark[i] = 1; break }
        }
      }
    }
    for (let i = 0; i < size * size; i++) {
      if (!mark[i]) continue
      const col = outlineColor(prims[primOf[i]].color)
      px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 255
    }
  }
  return img
}
