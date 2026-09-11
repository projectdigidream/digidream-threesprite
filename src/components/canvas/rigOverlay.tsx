/**
 * Bone gizmos on the pixel canvas, and the drags that edit them, in 3D.
 * Bones are projected into the current view; dragging moves or rotates a
 * bone in the plane of that view (root drags keep the bone's depth, tip
 * drags rotate about the axis pointing at the camera). Rig mode edits the
 * rest pose; Animate mode writes keys at the current frame.
 */
import { setKey } from '../../domain/animation'
import { apply3, applyAffine, axisAngle, eulerFromMatrix, mul3, normalize3, rotationOf3, sub3, transpose3, unprojectPoint, viewAxes, type Mat34, type ViewProj } from '../../domain/math3'
import { evalPose, projectBone, viewProj } from '../../domain/pose'
import { ensureBoneTrack } from '../../domain/project'
import type { Animation, Id, Project, Vec2, Vec3 } from '../../domain/types'
import type { EditorState, UiState } from '../../store/editorStore'

type Pt = { x: number; y: number }

export interface RigDrag {
  boneId: Id
  handle: 'root' | 'tip' | 'pivot'
  partId?: Id
  /** Canvas-space grab offset so the handle does not jump. */
  grab: Pt
  /** Latest preview values; applied to the doc on finish. */
  preview: { position?: Vec3; rotation?: Vec3; length?: number; offset?: Vec2 }
  finish: (s: EditorState) => void
  cancel: (s: EditorState) => void
  ctx: DragCtx
}

interface DragCtx {
  vp: ViewProj
  anim: Animation | null
  frame: number
  world: Mat34
  parentWorld: Mat34 | null
  origin: Pt
  depth: number
  startAngle: number
  unitLen: number
  restAngle: number
}

const BONE_COLOR = 'rgba(94,200,255,0.95)'
const BONE_SEL = 'rgba(255,180,84,1)'
const PIVOT_COLOR = 'rgba(255,120,200,1)'

function anims(doc: Project, animId: Id | null) {
  return animId ? doc.animations[animId] ?? null : null
}

export function drawRigOverlay(ctx: CanvasRenderingContext2D, doc: Project, ui: UiState, animId: Id | null, frame: number, view: number, toScreen: (x: number, y: number) => Pt, drag: RigDrag | null): void {
  const anim = anims(doc, animId)
  const pose = drag ? previewPose(doc, anim, frame, drag) : evalPose(doc.skeleton, anim, frame)
  const vp = viewProj(doc, view)
  ctx.save()
  ctx.lineWidth = 2
  const projections = new Map<Id, ReturnType<typeof projectBone>>()
  for (const [id, m] of pose) {
    const bone = doc.skeleton.bones[id]
    if (!bone) continue
    projections.set(id, projectBone(m, bone.length, vp))
  }
  // draw far bones first so near ones read on top
  const order = [...projections.entries()].sort((a, b) => a[1].depth - b[1].depth)
  for (const [id, pr] of order) {
    const bone = doc.skeleton.bones[id]
    const a = toScreen(pr.origin.x, pr.origin.y)
    const b = toScreen(pr.tip.x, pr.tip.y)
    const sel = id === ui.selectedBoneId
    ctx.strokeStyle = sel ? BONE_SEL : BONE_COLOR
    ctx.fillStyle = ctx.strokeStyle
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
    ctx.beginPath(); ctx.arc(a.x, a.y, sel ? 6 : 5, 0, Math.PI * 2); ctx.fillStyle = '#1f2430'; ctx.fill(); ctx.stroke()
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillText(bone.name, a.x + 8, a.y - 8)
  }
  // pivot handle of the selected pixel part (rest pose only)
  const part = ui.selectedPartId ? doc.parts[ui.selectedPartId] : null
  if (part && !part.solids && !anim) {
    const pr = projections.get(part.boneId)
    if (pr) {
      const off = drag?.handle === 'pivot' && drag.preview.offset ? drag.preview.offset : part.offset
      const p = toScreen(...xy(offsetToCanvas(pr, off)))
      ctx.strokeStyle = PIVOT_COLOR
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y); ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7); ctx.stroke()
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.stroke()
    }
  }
  ctx.restore()
}

function xy(p: Pt): [number, number] { return [p.x, p.y] }

/** Canvas point of a part offset in a bone's projected frame. */
function offsetToCanvas(pr: ReturnType<typeof projectBone>, off: Vec2): Pt {
  const a = (pr.angle * Math.PI) / 180
  // rotate(deg) in canvas space: x' = cos·x + sin·y ; y' = −sin·x + cos·y
  return { x: pr.origin.x + Math.cos(a) * off.x + Math.sin(a) * off.y, y: pr.origin.y - Math.sin(a) * off.x + Math.cos(a) * off.y }
}

/** World matrices with a drag's preview values applied (without touching the doc). */
function previewPose(doc: Project, anim: Animation | null, frame: number, drag: RigDrag): Map<Id, Mat34> {
  const p = drag.preview
  if (drag.handle === 'pivot' || (!p.position && !p.rotation && p.length === undefined)) return evalPose(doc.skeleton, anim, frame)
  const bone = doc.skeleton.bones[drag.boneId]
  if (!anim) {
    const patched = { ...doc.skeleton, bones: { ...doc.skeleton.bones, [drag.boneId]: { ...bone, length: p.length ?? bone.length, rest: { position: p.position ?? bone.rest.position, rotation: p.rotation ?? bone.rest.rotation } } } }
    return evalPose(patched, null, frame)
  }
  const track = anim.boneTracks[drag.boneId] ?? { rotation: [], translate: [], scale: [] }
  const rot = track.rotation.map(k => ({ ...k }))
  const tr = track.translate.map(k => ({ ...k }))
  if (p.rotation) setKey(rot, frame, p.rotation)
  if (p.position) setKey(tr, frame, p.position)
  const patchedAnim = { ...anim, boneTracks: { ...anim.boneTracks, [drag.boneId]: { ...track, rotation: rot, translate: tr } } }
  const patchedSkel = p.length !== undefined ? { ...doc.skeleton, bones: { ...doc.skeleton.bones, [drag.boneId]: { ...bone, length: p.length } } } : doc.skeleton
  return evalPose(patchedSkel, patchedAnim, frame)
}

/** Find a handle under canvas point `c` (radius in canvas pixels). Selected bone first, then pivots, then nearest others. */
export function hitRig(doc: Project, ui: UiState, animId: Id | null, frame: number, view: number, c: Pt, radius: number): RigDrag | null {
  const anim = anims(doc, animId)
  const pose = evalPose(doc.skeleton, anim, frame)
  const vp = viewProj(doc, view)
  const near = (p: Pt) => Math.hypot(p.x - c.x, p.y - c.y) <= radius

  const part = ui.selectedPartId ? doc.parts[ui.selectedPartId] : null
  if (part && !part.solids && !anim) {
    const w = pose.get(part.boneId)
    const bone = doc.skeleton.bones[part.boneId]
    if (w && bone) {
      const pr = projectBone(w, bone.length, vp)
      if (near(offsetToCanvas(pr, part.offset))) return makePivotDrag(doc, part.id, pr, c, vp, anim, frame, w)
    }
  }
  const order: Id[] = []
  if (ui.selectedBoneId) order.push(ui.selectedBoneId)
  for (const id of pose.keys()) if (id !== ui.selectedBoneId) order.push(id)
  for (const handle of ['tip', 'root'] as const) {
    for (const id of order) {
      const bone = doc.skeleton.bones[id]
      const w = pose.get(id)
      if (!bone || !w) continue
      const pr = projectBone(w, bone.length, vp)
      const p = handle === 'root' ? pr.origin : pr.tip
      if (near(p)) return makeBoneDrag(doc, anim, frame, id, handle, w, pose, c, vp)
    }
  }
  return null
}

function makePivotDrag(doc: Project, partId: Id, pr: ReturnType<typeof projectBone>, c: Pt, vp: ViewProj, anim: Animation | null, frame: number, world: Mat34): RigDrag {
  const part = doc.parts[partId]
  const start = offsetToCanvas(pr, part.offset)
  const drag: RigDrag = {
    boneId: part.boneId,
    handle: 'pivot',
    partId,
    grab: { x: c.x - start.x, y: c.y - start.y },
    preview: {},
    ctx: { vp, anim, frame, world, parentWorld: null, origin: pr.origin, depth: pr.depth, startAngle: pr.angle, unitLen: 0, restAngle: pr.angle },
    finish(s) {
      const off = drag.preview.offset
      if (!off) return
      s.commit('Move pivot', d => { const p = d.parts[partId]; if (p) p.offset = { x: Math.round(off.x), y: Math.round(off.y) } })
    },
    cancel() { drag.preview = {} },
  }
  return drag
}

function makeBoneDrag(doc: Project, anim: Animation | null, frame: number, boneId: Id, handle: 'root' | 'tip', world: Mat34, pose: Map<Id, Mat34>, c: Pt, vp: ViewProj): RigDrag {
  const bone = doc.skeleton.bones[boneId]
  const parentWorld = bone.parentId ? pose.get(bone.parentId) ?? null : null
  const pr = projectBone(world, bone.length, vp)
  const grab = handle === 'root' ? { x: c.x - pr.origin.x, y: c.y - pr.origin.y } : { x: c.x - pr.tip.x, y: c.y - pr.tip.y }
  const drag: RigDrag = {
    boneId,
    handle,
    grab,
    preview: {},
    ctx: { vp, anim, frame, world, parentWorld, origin: pr.origin, depth: pr.depth, startAngle: pr.angle, unitLen: bone.length > 0 ? pr.length / bone.length : 0, restAngle: pr.angle },
    finish(s) {
      const p = drag.preview
      if (!p.position && !p.rotation && p.length === undefined) return
      if (!anim) {
        s.commit(handle === 'root' ? 'Move bone' : 'Rotate bone', d => {
          const b = d.skeleton.bones[boneId]
          if (!b) return
          if (p.position) b.rest.position = p.position
          if (p.rotation) b.rest.rotation = p.rotation
          if (p.length !== undefined) b.length = p.length
        })
      } else {
        s.commit(handle === 'root' ? 'Key move' : 'Key rotation', d => {
          const a = d.animations[anim.id]
          if (!a) return
          const t = ensureBoneTrack(a, boneId)
          if (p.rotation) setKey(t.rotation, frame, p.rotation)
          if (p.position) setKey(t.translate, frame, p.position)
          if (p.length !== undefined) { const b = d.skeleton.bones[boneId]; if (b) b.length = p.length }
        })
      }
    },
    cancel() { drag.preview = {} },
  }
  return drag
}

const round1 = (v: number) => Math.round(v * 10) / 10
const r3 = (v: Vec3): Vec3 => ({ r: round1(v.r), u: round1(v.u), f: round1(v.f) })
const wrap = (d: number) => { let x = d % 360; if (x > 180) x -= 360; if (x <= -180) x += 360; return x }

/** Update a drag's preview from the pointer (canvas space). Shift on a tip drag changes the length instead. */
export function rigDragMove(s: EditorState, drag: RigDrag, c: Pt, shift: boolean): void {
  const doc = s.doc
  const bone = doc.skeleton.bones[drag.boneId]
  if (!bone) return
  const { ctx } = drag
  const target = { x: c.x - drag.grab.x, y: c.y - drag.grab.y }

  if (drag.handle === 'pivot') {
    // offset in the projected frame: inverse of offsetToCanvas
    const a = (ctx.startAngle * Math.PI) / 180
    const dx = target.x - ctx.origin.x, dy = target.y - ctx.origin.y
    drag.preview = { offset: { x: Math.round(Math.cos(a) * dx - Math.sin(a) * dy), y: Math.round(Math.sin(a) * dx + Math.cos(a) * dy) } }
    return
  }

  const parentRotT = ctx.parentWorld ? transpose3(rotationOf3(ctx.parentWorld)) : null
  const parentT = ctx.parentWorld ? ctx.parentWorld.t : { r: 0, u: 0, f: 0 }

  if (drag.handle === 'root') {
    const world = unprojectPoint(target.x, target.y, ctx.depth, ctx.vp)
    const local = parentRotT ? apply3(parentRotT, sub3(world, parentT)) : world
    if (!ctx.anim) drag.preview = { position: r3(local) }
    else drag.preview = { position: r3(sub3(local, bone.rest.position)) }
    return
  }

  // tip
  if (shift) {
    if (ctx.unitLen > 0.05) drag.preview = { ...drag.preview, length: Math.max(1, Math.round(Math.hypot(target.x - ctx.origin.x, target.y - ctx.origin.y) / ctx.unitLen)) }
    return
  }
  const desired = (-Math.atan2(target.y - ctx.origin.y, target.x - ctx.origin.x) * 180) / Math.PI
  const delta = desired - ctx.startAngle
  const axes = viewAxes(ctx.vp)
  const newWorldRot = mul3(axisAngle(axes.toward, delta), rotationOf3(ctx.world))
  const localRot = parentRotT ? mul3(parentRotT, newWorldRot) : newWorldRot
  const e = eulerFromMatrix(localRot)
  if (!ctx.anim) drag.preview = { rotation: r3({ r: wrap(e.r), u: wrap(e.u), f: wrap(e.f) }) }
  else drag.preview = { rotation: r3({ r: wrap(e.r - bone.rest.rotation.r), u: wrap(e.u - bone.rest.rotation.u), f: wrap(e.f - bone.rest.rotation.f) }) }
}

/**
 * Rest transform for a new bone drawn from canvas `root` to `tip` in `view`,
 * as a child of `parentId` (kept in the parent's plane / depth).
 */
export function boneFromDrag(doc: Project, parentId: Id | null, root: Pt, tip: Pt, view: number): { position: Vec3; rotation: Vec3; length: number } {
  const vp = viewProj(doc, view)
  const pose = evalPose(doc.skeleton, null, 0)
  const parentWorld = parentId ? pose.get(parentId) ?? null : null
  const depth = parentWorld ? projectBone(parentWorld, 0, vp).depth : 0
  const r3d = unprojectPoint(root.x, root.y, depth, vp)
  const t3d = unprojectPoint(tip.x, tip.y, depth, vp)
  const dir = sub3(t3d, r3d)
  const length = Math.max(1, Math.round(Math.hypot(dir.r, dir.u, dir.f)))
  const angle = (-Math.atan2(tip.y - root.y, tip.x - root.x) * 180) / Math.PI
  const axes = viewAxes(vp)
  const worldRot = axisAngle(axes.toward, angle - 90)
  const parentRotT = parentWorld ? transpose3(rotationOf3(parentWorld)) : null
  const localRot = parentRotT ? mul3(parentRotT, worldRot) : worldRot
  const e = eulerFromMatrix(localRot)
  const local = parentRotT ? apply3(parentRotT, sub3(r3d, parentWorld!.t)) : r3d
  void normalize3
  return { position: r3(local), rotation: r3({ r: wrap(e.r), u: wrap(e.u), f: wrap(e.f) }), length }
}

/** Bone-local displacement for a screen drag of `dx, dy` canvas pixels in `view` (for moving solids). */
export function screenDeltaToBoneLocal(doc: Project, animId: Id | null, frame: number, boneId: Id, view: number, dx: number, dy: number): Vec3 {
  const vp = viewProj(doc, view)
  const axes = viewAxes(vp)
  const world = { r: axes.right.r * dx - axes.up.r * dy, u: axes.right.u * dx - axes.up.u * dy, f: axes.right.f * dx - axes.up.f * dy }
  const w = evalPose(doc.skeleton, anims(doc, animId), frame).get(boneId)
  if (!w) return world
  return apply3(transpose3(rotationOf3(w)), world)
}

export { applyAffine }
