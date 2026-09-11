/**
 * Skeleton evaluation in 3D and its projection into a view. A bone's own
 * axis is +u (a bone with zero rotation points up). Pixel parts hang off
 * the bone's PROJECTED 2D frame in each view; solids hang off its 3D frame.
 */
import { lerpVec3, sampleTrack, stepOnly } from './animation'
import { add3, affine, applyAffine, composeAffine, eulerMatrix, mul3, projectPoint, projectedAngle, scaleMatrix, type Mat34, type ViewProj } from './math3'
import { compose, rotate, scale as scale2, translate, type Mat2D } from './transform'
import type { Animation, Bone, Id, Part, Project, Skeleton, Vec3 } from './types'
import { ONE3, ZERO3 } from './types'

export interface BoneSample { rotation: Vec3; translate: Vec3; scale: Vec3 }
export interface PartSample { visible: boolean; variantId: Id }

export function sampleBone(anim: Animation | null, boneId: Id, frame: number): BoneSample {
  const t = anim?.boneTracks[boneId]
  if (!t) return { rotation: ZERO3, translate: ZERO3, scale: ONE3 }
  return {
    rotation: sampleTrack(t.rotation, frame, ZERO3, lerpVec3),
    translate: sampleTrack(t.translate, frame, ZERO3, lerpVec3),
    scale: sampleTrack(t.scale, frame, ONE3, lerpVec3),
  }
}

export function samplePart(anim: Animation | null, part: Part, frame: number): PartSample {
  const t = anim?.partTracks[part.id]
  if (!t) return { visible: true, variantId: part.defaultVariant }
  return {
    visible: sampleTrack(t.visible, frame, true, stepOnly),
    variantId: sampleTrack(t.variant, frame, part.defaultVariant, stepOnly),
  }
}

/** Local affine of a bone: T(rest.position + translate) · R(rest.rotation + rotation) · S(scale). */
export function boneLocal(bone: Bone, s: BoneSample): Mat34 {
  const rot = add3(bone.rest.rotation, s.rotation)
  return affine(mul3(eulerMatrix(rot), scaleMatrix(s.scale)), add3(bone.rest.position, s.translate))
}

/** World (character-frame) affine of every bone at `frame` of `anim` (rest pose when null). */
export function evalPose(skel: Skeleton, anim: Animation | null, frame: number): Map<Id, Mat34> {
  const world = new Map<Id, Mat34>()
  const visit = (id: Id, parent: Mat34 | null) => {
    const bone = skel.bones[id]
    if (!bone) return
    const local = boneLocal(bone, sampleBone(anim, id, frame))
    const m = parent ? composeAffine(parent, local) : local
    world.set(id, m)
    for (const c of bone.children) visit(c, m)
  }
  for (const root of skel.rootOrder) visit(root, null)
  return world
}

export interface BoneProjection {
  origin: { x: number; y: number }
  tip: { x: number; y: number }
  /** Screen angle of the bone, degrees CCW on screen; 90 = up. */
  angle: number
  /** Projected length in pixels. */
  length: number
  depth: number
}

const MIN_PROJECTED = 0.5

/** The bone's 2D frame in a view. A bone pointing straight at the camera keeps `fallbackAngle`. */
export function projectBone(world: Mat34, length: number, vp: ViewProj, fallbackAngle = 90): BoneProjection {
  const o = projectPoint(applyAffine(world, ZERO3), vp)
  const t = projectPoint(applyAffine(world, { r: 0, u: length, f: 0 }), vp)
  const pa = projectedAngle(o, t)
  const angle = pa.length < MIN_PROJECTED ? fallbackAngle : pa.angle
  return { origin: { x: o.x, y: o.y }, tip: { x: t.x, y: t.y }, angle, length: pa.length, depth: o.depth }
}

/**
 * Image-pixel → canvas matrix of a pixel part in one view:
 * T(origin) · R(angle) · S(foreshorten, 1) · T(offset) · R(part.rotation) · T(−pivot).
 * `rest` is the bone's projection in the rest pose (what the artist drew against).
 */
export function partMatrix(rest: BoneProjection, cur: BoneProjection, part: Part): Mat2D {
  let fs = 1
  if (part.foreshorten && rest.length >= MIN_PROJECTED) fs = Math.max(0.15, Math.min(4, cur.length / rest.length))
  const angle = cur.length < MIN_PROJECTED ? rest.angle : cur.angle
  return compose(translate(cur.origin.x, cur.origin.y), rotate(angle), scale2(fs, 1), translate(part.offset.x, part.offset.y), rotate(part.rotation), translate(-part.pivot.x, -part.pivot.y))
}

export function viewProj(p: Project, view: number): ViewProj {
  return { N: p.views.count, view, size: p.canvas.size, elevationDeg: p.views.elevationDeg }
}

/** Rest-pose projected angle of a bone in a view (used to keep new part images upright). */
export function restProjectedAngle(p: Project, boneId: Id, view = 1): number {
  const world = evalPose(p.skeleton, null, 0).get(boneId)
  const bone = p.skeleton.bones[boneId]
  if (!world || !bone) return 90
  return projectBone(world, bone.length, viewProj(p, view)).angle
}
