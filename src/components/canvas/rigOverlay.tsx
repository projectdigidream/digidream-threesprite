/**
 * Bone gizmos on the pixel canvas, and the drags that edit them. Rig mode
 * edits the rest pose; Animate mode writes keys at the current frame.
 * Pure canvas-2D drawing + store mutations; no React.
 */
import { setKey } from '../../domain/animation'
import { evalPose, partMatrix } from '../../domain/pose'
import { ensureBoneTrack } from '../../domain/project'
import { apply, invert, rotationOf, type Mat2D } from '../../domain/transform'
import type { Id, Project, Vec2 } from '../../domain/types'
import type { EditorState, UiState } from '../../store/editorStore'

type Pt = { x: number; y: number }

export interface RigDrag {
  boneId: Id
  handle: 'root' | 'tip' | 'pivot'
  partId?: Id
  /** Canvas-space grab offset so the handle does not jump. */
  grab: Pt
  /** Latest preview values; applied to the doc on finish. */
  preview: { x?: number; y?: number; rotation?: number; length?: number; offset?: Vec2 }
  finish: (s: EditorState) => void
  cancel: (s: EditorState) => void
}

const BONE_COLOR = 'rgba(94,200,255,0.95)'
const BONE_SEL = 'rgba(255,180,84,1)'
const PIVOT_COLOR = 'rgba(255,120,200,1)'

function bonePose(doc: Project, animId: Id | null, frame: number) {
  const anim = animId ? doc.animations[animId] ?? null : null
  return { anim, pose: evalPose(doc.skeleton, anim, frame) }
}

export function drawRigOverlay(ctx: CanvasRenderingContext2D, doc: Project, ui: UiState, animId: Id | null, frame: number, toScreen: (x: number, y: number) => Pt, drag: RigDrag | null): void {
  const { pose } = bonePose(doc, animId, frame)
  const previewMats = drag ? previewPose(doc, animId, frame, drag) : pose
  ctx.save()
  ctx.lineWidth = 2
  for (const [id, m] of previewMats) {
    const bone = doc.skeleton.bones[id]
    if (!bone) continue
    const a = toScreen(...xy(apply(m, 0, 0)))
    const b = toScreen(...xy(apply(m, bone.length, 0)))
    const sel = id === ui.selectedBoneId
    ctx.strokeStyle = sel ? BONE_SEL : BONE_COLOR
    ctx.fillStyle = ctx.strokeStyle
    // shaft as a thin triangle
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const w = 4
    ctx.beginPath()
    ctx.moveTo(a.x + Math.cos(ang + Math.PI / 2) * w, a.y + Math.sin(ang + Math.PI / 2) * w)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(a.x + Math.cos(ang - Math.PI / 2) * w, a.y + Math.sin(ang - Math.PI / 2) * w)
    ctx.closePath()
    ctx.globalAlpha = 0.35
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.stroke()
    // root circle
    ctx.beginPath(); ctx.arc(a.x, a.y, sel ? 6 : 5, 0, Math.PI * 2); ctx.fillStyle = '#1f2430'; ctx.fill(); ctx.stroke()
    // tip
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill()
    // name
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(bone.name, a.x + 8, a.y - 8)
  }
  // pivot handle of the selected part
  if (ui.selectedPartId && doc.parts[ui.selectedPartId]) {
    const part = doc.parts[ui.selectedPartId]
    const bm = previewMats.get(part.boneId)
    if (bm) {
      const off = drag?.handle === 'pivot' && drag.preview.offset ? drag.preview.offset : part.offset
      const p = toScreen(...xy(apply(bm, off.x, off.y)))
      ctx.strokeStyle = PIVOT_COLOR
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke()
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.restore()
}

function xy(p: Pt): [number, number] { return [p.x, p.y] }

/** World matrices with a drag's preview values applied (without touching the doc). */
function previewPose(doc: Project, animId: Id | null, frame: number, drag: RigDrag): Map<Id, Mat2D> {
  const anim = animId ? doc.animations[animId] ?? null : null
  if (drag.handle === 'pivot' || Object.keys(drag.preview).length === 0) return evalPose(doc.skeleton, anim, frame)
  // temporarily patch a shallow copy of the skeleton / animation
  const bone = doc.skeleton.bones[drag.boneId]
  const p = drag.preview
  if (!anim) {
    const patched = { ...doc.skeleton, bones: { ...doc.skeleton.bones, [drag.boneId]: { ...bone, length: p.length ?? bone.length, rest: { ...bone.rest, x: p.x ?? bone.rest.x, y: p.y ?? bone.rest.y, rotation: p.rotation ?? bone.rest.rotation } } } }
    return evalPose(patched, null, frame)
  }
  const track = anim.boneTracks[drag.boneId] ?? { rotation: [], translate: [], scale: [] }
  const rot = track.rotation.map(k => ({ ...k }))
  const tr = track.translate.map(k => ({ ...k, value: { ...k.value } }))
  if (p.rotation !== undefined) setKey(rot, frame, p.rotation)
  if (p.x !== undefined || p.y !== undefined) setKey(tr, frame, { x: p.x ?? 0, y: p.y ?? 0 })
  const patchedAnim = { ...anim, boneTracks: { ...anim.boneTracks, [drag.boneId]: { ...track, rotation: rot, translate: tr } } }
  const patchedSkel = p.length !== undefined ? { ...doc.skeleton, bones: { ...doc.skeleton.bones, [drag.boneId]: { ...bone, length: p.length } } } : doc.skeleton
  return evalPose(patchedSkel, patchedAnim, frame)
}

/** Find a handle under canvas point `c` (radius in canvas pixels). Selected bone's handles win, then pivots, then any root/tip. */
export function hitRig(doc: Project, ui: UiState, animId: Id | null, frame: number, c: Pt, radius: number): RigDrag | null {
  const { anim, pose } = bonePose(doc, animId, frame)
  const near = (p: Pt) => Math.hypot(p.x - c.x, p.y - c.y) <= radius

  // pivot of the selected part
  if (ui.selectedPartId && doc.parts[ui.selectedPartId] && !anim) {
    const part = doc.parts[ui.selectedPartId]
    const bm = pose.get(part.boneId)
    if (bm && near(apply(bm, part.offset.x, part.offset.y))) return makePivotDrag(doc, part.id, bm, c)
  }
  const order: Id[] = []
  if (ui.selectedBoneId) order.push(ui.selectedBoneId)
  for (const id of pose.keys()) if (id !== ui.selectedBoneId) order.push(id)
  // tips first (smaller targets), then roots
  for (const handle of ['tip', 'root'] as const) {
    for (const id of order) {
      const bone = doc.skeleton.bones[id]
      const m = pose.get(id)
      if (!bone || !m) continue
      const p = handle === 'root' ? apply(m, 0, 0) : apply(m, bone.length, 0)
      if (near(p)) return makeBoneDrag(doc, anim, frame, id, handle, m, c)
    }
  }
  return null
}

function makePivotDrag(doc: Project, partId: Id, boneWorld: Mat2D, c: Pt): RigDrag {
  const part = doc.parts[partId]
  const start = apply(boneWorld, part.offset.x, part.offset.y)
  const inv = invert(boneWorld)!
  const drag: RigDrag = {
    boneId: part.boneId,
    handle: 'pivot',
    partId,
    grab: { x: c.x - start.x, y: c.y - start.y },
    preview: {},
    finish(s) {
      const off = drag.preview.offset
      if (!off) return
      s.commit('Move pivot', d => { const p = d.parts[partId]; if (p) p.offset = { x: Math.round(off.x), y: Math.round(off.y) } })
    },
    cancel() { drag.preview = {} },
  }
  ;(drag as RigDrag & { inv: Mat2D }).inv = inv
  return drag
}

function makeBoneDrag(doc: Project, anim: Project['animations'][string] | null, frame: number, boneId: Id, handle: 'root' | 'tip', world: Mat2D, c: Pt): RigDrag {
  const bone = doc.skeleton.bones[boneId]
  const parentWorld = bone.parentId ? evalPose(doc.skeleton, anim, frame).get(bone.parentId)! : null
  const origin = apply(world, 0, 0)
  const tip = apply(world, bone.length, 0)
  const grab = handle === 'root' ? { x: c.x - origin.x, y: c.y - origin.y } : { x: c.x - tip.x, y: c.y - tip.y }
  const drag: RigDrag = {
    boneId,
    handle,
    grab,
    preview: {},
    finish(s) {
      const p = drag.preview
      if (Object.keys(p).length === 0) return
      if (!anim) {
        s.commit(handle === 'root' ? 'Move bone' : 'Rotate bone', d => {
          const b = d.skeleton.bones[boneId]
          if (!b) return
          if (p.x !== undefined) b.rest.x = p.x
          if (p.y !== undefined) b.rest.y = p.y
          if (p.rotation !== undefined) b.rest.rotation = p.rotation
          if (p.length !== undefined) b.length = p.length
        })
      } else {
        s.commit(handle === 'root' ? 'Key translate' : 'Key rotation', d => {
          const a = d.animations[anim.id]
          if (!a) return
          const t = ensureBoneTrack(a, boneId)
          if (p.rotation !== undefined) setKey(t.rotation, frame, p.rotation)
          if (p.x !== undefined || p.y !== undefined) setKey(t.translate, frame, { x: p.x ?? 0, y: p.y ?? 0 })
          if (p.length !== undefined) { const b = d.skeleton.bones[boneId]; if (b) b.length = p.length }
        })
      }
    },
    cancel() { drag.preview = {} },
  }
  const extra = drag as RigDrag & { parentWorld: Mat2D | null; origin: Pt; anim: typeof anim; frame: number }
  extra.parentWorld = parentWorld
  extra.origin = origin
  extra.anim = anim
  extra.frame = frame
  return drag
}

/** Update a drag's preview from the pointer (canvas space). Shift on a tip drag changes the length instead. */
export function rigDragMove(s: EditorState, drag: RigDrag, c: Pt, shift: boolean): void {
  const doc = s.doc
  const bone = doc.skeleton.bones[drag.boneId]
  if (!bone) return
  const target = { x: c.x - drag.grab.x, y: c.y - drag.grab.y }

  if (drag.handle === 'pivot') {
    const inv = (drag as RigDrag & { inv: Mat2D }).inv
    const local = apply(inv, target.x, target.y)
    drag.preview = { offset: { x: Math.round(local.x), y: Math.round(local.y) } }
    return
  }

  const ex = drag as RigDrag & { parentWorld: Mat2D | null; origin: Pt; anim: Project['animations'][string] | null; frame: number }
  const parentInv = ex.parentWorld ? invert(ex.parentWorld) : null
  const parentRot = ex.parentWorld ? rotationOf(ex.parentWorld) : 0

  if (drag.handle === 'root') {
    const local = parentInv ? apply(parentInv, target.x, target.y) : target
    const x = Math.round(local.x), y = Math.round(local.y)
    if (!ex.anim) drag.preview = { x, y }
    else {
      // key = local − rest
      const tr = { x: x - bone.rest.x, y: y - bone.rest.y }
      drag.preview = { x: tr.x, y: tr.y }
    }
    return
  }

  // tip: rotation (or length with shift) about the bone origin
  const dx = target.x - ex.origin.x
  const dy = target.y - ex.origin.y
  if (shift) {
    drag.preview = { ...drag.preview, length: Math.max(1, Math.round(Math.hypot(dx, dy))) }
    return
  }
  const worldDeg = (-Math.atan2(dy, dx) * 180) / Math.PI // CCW on screen
  const local = worldDeg - parentRot
  if (!ex.anim) drag.preview = { rotation: Math.round(normDeg(local)) }
  else {
    // animated value on top of rest, keeping the current scale's contribution ignored (rotation only)
    const key = normDeg(local - bone.rest.rotation)
    drag.preview = { rotation: Math.round(key) }
  }
}

function normDeg(d: number): number {
  let r = d % 360
  if (r > 180) r -= 360
  if (r < -180) r += 360
  return r
}

/** Canvas-space matrix for a part in the current pose (used by the Inspector to show numbers). */
export function partWorld(doc: Project, animId: Id | null, frame: number, partId: Id): Mat2D | null {
  const part = doc.parts[partId]
  if (!part) return null
  const { pose } = bonePose(doc, animId, frame)
  const bm = pose.get(part.boneId)
  return bm ? partMatrix(bm, part) : null
}
