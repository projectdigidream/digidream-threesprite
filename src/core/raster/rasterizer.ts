/**
 * The one compositor. The 2D editor, the 3D preview textures and every
 * exporter call `composeFrame`, so what is on screen is byte-identical to
 * what ships. Nearest-neighbour only; pixel art must never be anti-aliased.
 */
import { flipXPixelsInPlace } from '../../domain/image'
import { evalPose, partMatrix, samplePart } from '../../domain/pose'
import { invert, type Mat2D } from '../../domain/transform'
import type { Id, PartImage, Project, ViewIndex } from '../../domain/types'
import { isDerived, mirrorOf } from '../../domain/views'

/** Key used by `overrides` maps: the working copy of an image during a stroke. */
export function imageKey(partId: Id, variantId: Id, view: ViewIndex): string {
  return `${partId}/${variantId}/${view}`
}

export interface ComposeOptions {
  /** Live replacements for part images (pixel editor strokes in progress). */
  overrides?: ReadonlyMap<string, PartImage>
  /** Reuse this buffer (must be size²·4 bytes). Cleared first. */
  out?: Uint8ClampedArray
  /** Alpha multiplier for every part except `except` (editor ghosting of unselected parts). */
  dim?: { except: Id | null; alpha: number }
  /** Draw only these parts. */
  only?: ReadonlySet<Id>
}

const SNAP_EPS = 1e-6

/**
 * Pixel-art snapping: the pivot lands on a pixel corner (integer tx, ty), and
 * a matrix that is a 0/90/180/270° rotation with unit scale (or flips) is
 * quantised to exactly {-1, 0, 1} so the blit is a pure pixel permutation.
 */
export function snapMatrix(m: Mat2D): Mat2D {
  const q = (v: number) => (Math.abs(v) < SNAP_EPS ? 0 : Math.abs(v - 1) < SNAP_EPS ? 1 : Math.abs(v + 1) < SNAP_EPS ? -1 : v)
  const a = q(m.a), b = q(m.b), c = q(m.c), d = q(m.d)
  const axisAligned = (a === 0 || a === 1 || a === -1) && (b === 0 || b === 1 || b === -1) && (c === 0 || c === 1 || c === -1) && (d === 0 || d === 1 || d === -1)
  return {
    a: axisAligned ? a : m.a,
    b: axisAligned ? b : m.b,
    c: axisAligned ? c : m.c,
    d: axisAligned ? d : m.d,
    tx: Math.round(m.tx),
    ty: Math.round(m.ty),
  }
}

/**
 * Draw `src` through matrix `m` (image pixels → destination pixels) onto a
 * `dw × dh` RGBA buffer with nearest-neighbour sampling and straight-alpha
 * source-over blending.
 */
export function blitNearest(dst: Uint8ClampedArray, dw: number, dh: number, src: PartImage, m: Mat2D, alphaMul = 1): void {
  const sw = src.width
  const sh = src.height
  const sp = src.pixels
  if (sw <= 0 || sh <= 0 || alphaMul <= 0) return

  // destination bounding box of the transformed image rectangle
  const cx = [m.tx, m.a * sw + m.tx, m.c * sh + m.tx, m.a * sw + m.c * sh + m.tx]
  const cy = [m.ty, m.b * sw + m.ty, m.d * sh + m.ty, m.b * sw + m.d * sh + m.ty]
  const x0 = Math.max(0, Math.floor(Math.min(cx[0], cx[1], cx[2], cx[3])))
  const x1 = Math.min(dw, Math.ceil(Math.max(cx[0], cx[1], cx[2], cx[3])))
  const y0 = Math.max(0, Math.floor(Math.min(cy[0], cy[1], cy[2], cy[3])))
  const y1 = Math.min(dh, Math.ceil(Math.max(cy[0], cy[1], cy[2], cy[3])))
  if (x0 >= x1 || y0 >= y1) return

  const inv = invert(m)
  if (!inv) return
  const ia = inv.a, ib = inv.b, ic = inv.c, id = inv.d, itx = inv.tx, ity = inv.ty

  for (let dy = y0; dy < y1; dy++) {
    const py = dy + 0.5
    const rowBase = dy * dw
    for (let dx = x0; dx < x1; dx++) {
      const px = dx + 0.5
      const sx = ia * px + ic * py + itx
      const sy = ib * px + id * py + ity
      const si = Math.floor(sx)
      const sj = Math.floor(sy)
      if (si < 0 || sj < 0 || si >= sw || sj >= sh) continue
      const s = (sj * sw + si) * 4
      let sa = sp[s + 3]
      if (sa === 0) continue
      if (alphaMul !== 1) sa *= alphaMul
      const d = (rowBase + dx) * 4
      if (sa >= 255) {
        dst[d] = sp[s]; dst[d + 1] = sp[s + 1]; dst[d + 2] = sp[s + 2]; dst[d + 3] = 255
        continue
      }
      const a = sa / 255
      const da = dst[d + 3] / 255
      const outA = a + da * (1 - a)
      if (outA <= 0) continue
      const wS = a / outA
      const wD = (da * (1 - a)) / outA
      dst[d] = sp[s] * wS + dst[d] * wD
      dst[d + 1] = sp[s + 1] * wS + dst[d + 1] * wD
      dst[d + 2] = sp[s + 2] * wS + dst[d + 2] * wD
      dst[d + 3] = outA * 255
    }
  }
}

/** Compose one (animation, frame, view) into a canvas-sized RGBA buffer. */
export function composeFrame(project: Project, animId: Id | null, frame: number, view: ViewIndex, opts: ComposeOptions = {}): Uint8ClampedArray {
  const size = project.canvas.size
  const N = project.views.count
  const out = opts.out ?? new Uint8ClampedArray(size * size * 4)
  if (opts.out) out.fill(0)

  const derived = isDerived(N, project.views.mirror, view)
  const srcView = derived ? mirrorOf(N, view) : view
  const anim = animId ? project.animations[animId] ?? null : null
  const pose = evalPose(project.skeleton, anim, frame)

  for (const partId of project.partOrder) {
    if (opts.only && !opts.only.has(partId)) continue
    const part = project.parts[partId]
    if (!part) continue
    const boneWorld = pose.get(part.boneId)
    if (!boneWorld) continue
    const s = samplePart(anim, part, frame)
    if (!s.visible) continue
    const variantId = part.variants[s.variantId] ? s.variantId : part.defaultVariant
    const key = imageKey(partId, variantId, srcView)
    const img = opts.overrides?.get(key) ?? part.variants[variantId]?.images[srcView]
    if (!img) continue
    const alpha = opts.dim && opts.dim.except !== partId ? opts.dim.alpha : 1
    blitNearest(out, size, size, img, snapMatrix(partMatrix(boneWorld, part)), alpha)
  }

  if (derived) flipXPixelsInPlace(out, size, size)
  return out
}

/** Canvas-space matrix of one part at (anim, frame), already snapped. Used by the editor to map pointer → image pixels. */
export function partCanvasMatrix(project: Project, animId: Id | null, frame: number, partId: Id): Mat2D | null {
  const part = project.parts[partId]
  if (!part) return null
  const anim = animId ? project.animations[animId] ?? null : null
  const pose = evalPose(project.skeleton, anim, frame)
  const bw = pose.get(part.boneId)
  if (!bw) return null
  return snapMatrix(partMatrix(bw, part))
}
