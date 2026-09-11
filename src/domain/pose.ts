import { lerpNumber, lerpVec2, sampleTrack, stepOnly } from './animation'
import { compose, rotate, scale, translate, type Mat2D } from './transform'
import type { Animation, Bone, Id, Part, Skeleton, Vec2 } from './types'

export interface BoneSample { rotation: number; translate: Vec2; scale: Vec2 }
export interface PartSample { visible: boolean; variantId: Id }

const ZERO2: Vec2 = { x: 0, y: 0 }
const ONE2: Vec2 = { x: 1, y: 1 }

export function sampleBone(anim: Animation | null, boneId: Id, frame: number): BoneSample {
  const t = anim?.boneTracks[boneId]
  if (!t) return { rotation: 0, translate: ZERO2, scale: ONE2 }
  return {
    rotation: sampleTrack(t.rotation, frame, 0, lerpNumber),
    translate: sampleTrack(t.translate, frame, ZERO2, lerpVec2),
    scale: sampleTrack(t.scale, frame, ONE2, lerpVec2),
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

/** Local matrix of a bone: T(rest + translate) · R(rest.rotation + rotation) · S(rest.scale · scale). */
export function boneLocal(bone: Bone, s: BoneSample): Mat2D {
  const r = bone.rest
  return compose(
    translate(r.x + s.translate.x, r.y + s.translate.y),
    rotate(r.rotation + s.rotation),
    scale(r.scaleX * s.scale.x, r.scaleY * s.scale.y),
  )
}

/** World (canvas-space) matrix of every bone at `frame` of `anim` (rest pose when null). */
export function evalPose(skel: Skeleton, anim: Animation | null, frame: number): Map<Id, Mat2D> {
  const world = new Map<Id, Mat2D>()
  const visit = (id: Id, parent: Mat2D | null) => {
    const bone = skel.bones[id]
    if (!bone) return
    const local = boneLocal(bone, sampleBone(anim, id, frame))
    const m = parent ? compose(parent, local) : local
    world.set(id, m)
    for (const c of bone.children) visit(c, m)
  }
  for (const root of skel.rootOrder) visit(root, null)
  return world
}

/** Image-pixel → canvas matrix of a part on its bone: bone · T(offset) · R(rotation) · T(−pivot). */
export function partMatrix(boneWorld: Mat2D, part: Part): Mat2D {
  return compose(boneWorld, translate(part.offset.x, part.offset.y), rotate(part.rotation), translate(-part.pivot.x, -part.pivot.y))
}

/** Rest-pose world rotation of a bone (sum of rest rotations up the chain), degrees. */
export function restWorldRotation(skel: Skeleton, boneId: Id): number {
  let r = 0
  let id: Id | null = boneId
  let guard = 0
  while (id && guard++ < 10000) {
    const b: Bone | undefined = skel.bones[id]
    if (!b) break
    r += b.rest.rotation
    id = b.parentId
  }
  return r
}
