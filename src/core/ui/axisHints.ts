/**
 * Which way on screen a move along each axis of a bone's parent frame goes,
 * in the view on the canvas, for the inspector's move fields.
 */
import { apply3, IDENTITY3, projectPoint } from '../../domain/math3'
import { evalPose, viewProj } from '../../domain/pose'
import { ZERO3 as ORIGIN, type Animation, type Bone, type Project } from '../../domain/types'
import { isDerived, mirrorOf } from '../../domain/views'

export type Axis = 'r' | 'u' | 'f'
export type AxisHints = Record<Axis, { arrow: string; words: string }>

const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗']
export const AXIS_NAMES: Record<Axis, string> = { r: 'right', u: 'up', f: 'forward' }

/**
 * Where a move along each axis of a bone's parent frame goes on screen in a
 * view: right, up and forward are the character's own, so its right is on
 * your left while it faces you. An arrow, or ⊙ / ⊗ for towards / away from
 * you. A mirrored view shows its source view flipped, and so are its arrows.
 */
export function axisHints(doc: Project, anim: Animation | null, frame: number, bone: Bone, view: number): AxisHints {
  const N = doc.views.count
  const derived = isDerived(N, doc.views.mirror, view)
  const vp = viewProj(doc, derived ? mirrorOf(N, view) : view)
  const parent = bone.parentId ? evalPose(doc.skeleton, anim, frame).get(bone.parentId)?.m : undefined
  const o = projectPoint(ORIGIN, vp)
  const hint = (axis: Axis) => {
    const q = projectPoint(apply3(parent ?? [...IDENTITY3], { r: axis === 'r' ? 1 : 0, u: axis === 'u' ? 1 : 0, f: axis === 'f' ? 1 : 0 }), vp)
    const dx = (q.x - o.x) * (derived ? -1 : 1)
    const dy = q.y - o.y
    if (Math.hypot(dx, dy) < 0.35) return q.depth > o.depth ? { arrow: '⊙', words: 'towards you' } : { arrow: '⊗', words: 'away from you' }
    const arrow = ARROWS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]
    return { arrow, words: `${arrow} on screen` }
  }
  return { r: hint('r'), u: hint('u'), f: hint('f') }
}
