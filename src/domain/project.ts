/**
 * Project construction and structural operations. Every mutating function
 * here takes the project (or an immer draft of it) and edits it in place; the
 * store wraps them in `commit()` so they are undoable.
 */
import { clampKeys } from './animation'
import { newId } from './ids'
import { createImage } from './image'
import { applyAffine, composeAffine, eulerFromMatrix, eulerMatrix, invertAffine, mul3, rotationOf3, type Mat34 } from './math3'
import { createPalette, DEFAULT_PALETTE, MAX_PALETTE, PRESET_PALETTES, uniquePaletteName } from './palette'
import { evalPose, projectBone, restProjectedAngle, viewProj } from './pose'
import { compose, rotate, translate } from './transform'
import {
  FORMAT_VERSION,
  MAX_CANVAS,
  MAX_FRAMES,
  MIN_CANVAS,
  MAX_SPRITE_NAME,
  SPRITE_NAME_RE,
  type Animation,
  type Bone,
  type Id,
  type Palette,
  type Part,
  type PartImage,
  type PartVariant,
  type Project,
  type RGBA,
  type Transform3,
  type Vec3,
  type ViewIndex,
} from './types'
import { authoredViews, clampViewCount, isDerived, mirrorOf } from './views'

export interface NewProjectOptions {
  name?: string
  spriteName?: string
  canvasSize?: number
  viewCount?: number
  mirror?: boolean
  elevationDeg?: number
  /** Create the default bone/part/animation (true) or an empty skeleton. */
  starter?: boolean
}

export function clampCanvasSize(n: number): number {
  if (!Number.isFinite(n)) return 64
  return Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(n)))
}

/**
 * Make a sprite id safe for file names, keeping the case the author typed.
 * Only Doom-style export cares about length, and it says so at export time.
 */
export function normalizeSpriteName(s: string): string {
  const clean = s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_SPRITE_NAME)
  return clean || 'SPRT'
}

export function createProject(opts: NewProjectOptions = {}): Project {
  const size = clampCanvasSize(opts.canvasSize ?? 64)
  const now = new Date().toISOString()
  const palette = createPalette(PRESET_PALETTES[0].name, DEFAULT_PALETTE)
  const p: Project = {
    formatVersion: FORMAT_VERSION,
    id: newId(),
    name: opts.name?.trim() || 'Untitled sprite',
    spriteName: normalizeSpriteName(opts.spriteName ?? 'SPRT'),
    canvas: { size },
    views: { count: clampViewCount(opts.viewCount ?? 8), mirror: opts.mirror ?? true, elevationDeg: opts.elevationDeg ?? 0 },
    palettes: { [palette.id]: palette },
    paletteOrder: [palette.id],
    activePaletteId: palette.id,
    skeleton: { bones: {}, rootOrder: [] },
    parts: {},
    partOrder: [],
    animations: {},
    animationOrder: [],
    export: { worldHeight: 1 },
    meta: { createdAt: now, modifiedAt: now },
  }
  if (opts.starter !== false) {
    // One bone standing at the feet point, pointing up; one upright part
    // covering the whole canvas so drawing "just works" before any rigging.
    const body = addBone(p, { name: 'body', length: Math.round(size * 0.6) })
    addPart(p, { name: 'body', boneId: body.id, width: size, height: size, pivot: { x: size / 2, y: size } })
    addAnimation(p, { name: 'idle', fps: 8, frameCount: 4, loop: true })
  }
  return p
}

// ── bones ────────────────────────────────────────────────────────────────────

export interface AddBoneOptions {
  name?: string
  parentId?: Id | null
  rest?: { position?: Partial<Vec3>; rotation?: Partial<Vec3> }
  length?: number
}

export function addBone(p: Project, opts: AddBoneOptions = {}): Bone {
  const parentId = opts.parentId ?? null
  if (parentId && !p.skeleton.bones[parentId]) throw new Error(`no such bone ${parentId}`)
  const rest: Transform3 = {
    position: { r: 0, u: 0, f: 0, ...opts.rest?.position },
    rotation: { r: 0, u: 0, f: 0, ...opts.rest?.rotation },
  }
  const bone: Bone = {
    id: newId(),
    name: opts.name?.trim() || uniqueName('bone', Object.values(p.skeleton.bones).map(b => b.name)),
    parentId,
    children: [],
    length: opts.length ?? Math.round(p.canvas.size / 4),
    rest,
  }
  p.skeleton.bones[bone.id] = bone
  if (parentId) p.skeleton.bones[parentId].children.push(bone.id)
  else p.skeleton.rootOrder.push(bone.id)
  return bone
}

/** Remove a bone. Children and parts move to its parent (or become roots / move to the first root). */
/** Remove a bone: children move up to its parent, its parts re-hang from the parent (or the first root) without moving in `view`. */
export function removeBone(p: Project, id: Id, view: ViewIndex = 1): void {
  const bone = p.skeleton.bones[id]
  if (!bone) return
  if (Object.keys(p.skeleton.bones).length <= 1) throw new Error('cannot remove the last bone')
  // The removed bone's rest frame, before the skeleton changes: its parts are
  // re-hung from the fallback bone so they stay where they are.
  const oldWorld = evalPose(p.skeleton, null, 0).get(id)
  const oldLength = bone.length
  const parentId = bone.parentId
  if (parentId) {
    const siblings = p.skeleton.bones[parentId].children
    const at = siblings.indexOf(id)
    siblings.splice(at, 1, ...bone.children)
  } else {
    const at = p.skeleton.rootOrder.indexOf(id)
    p.skeleton.rootOrder.splice(at, 1, ...bone.children)
  }
  for (const c of bone.children) p.skeleton.bones[c].parentId = parentId
  delete p.skeleton.bones[id]
  const fallback = parentId ?? p.skeleton.rootOrder[0]
  const newWorld = evalPose(p.skeleton, null, 0).get(fallback)
  for (const part of Object.values(p.parts)) {
    if (part.boneId === id) {
      if (oldWorld && newWorld) rehangPart(p, part, oldWorld, oldLength, fallback, newWorld, view)
      part.boneId = fallback
    }
    // A skin never lists the removed bone, nor the part's own (possibly new) bone.
    if (part.skin) part.skin.bones = part.skin.bones.filter(b => b !== id && b !== part.boneId)
  }
  for (const anim of Object.values(p.animations)) delete anim.boneTracks[id]
}

/**
 * Attach a part to another bone without moving it on screen. A pixel part has
 * one offset and rotation for every view, expressed in its bone's projected
 * frame, so it is re-expressed in the new bone's frame of `view`: it stays
 * exactly in place there and follows the new bone's frame in the other views.
 * A solids part's shapes are re-expressed in the new bone's 3D frame, so they
 * stay put in every view. Returns false when nothing changed.
 */
export function attachPart(p: Project, partId: Id, boneId: Id, view: ViewIndex = 1): boolean {
  const part = p.parts[partId]
  const bone = p.skeleton.bones[boneId]
  const oldBone = part ? p.skeleton.bones[part.boneId] : undefined
  if (!part || !bone || part.boneId === boneId) return false
  const pose = evalPose(p.skeleton, null, 0)
  const oldWorld = pose.get(part.boneId)
  const newWorld = pose.get(boneId)
  if (oldWorld && newWorld && oldBone) rehangPart(p, part, oldWorld, oldBone.length, boneId, newWorld, view)
  part.boneId = boneId
  if (part.skin) setPartSkin(p, partId, {})
  return true
}

/** Rewrite a part's placement from `oldWorld` (its current bone's rest frame) into `newWorld` (the rest frame of `boneId`). */
function rehangPart(p: Project, part: Part, oldWorld: Mat34, oldLength: number, boneId: Id, newWorld: Mat34, view: ViewIndex): void {
  if (part.solids) {
    const inv = invertAffine(newWorld)
    if (!inv) return
    const rel = composeAffine(inv, oldWorld)
    const relRot = rotationOf3(rel)
    for (const prim of Object.values(part.solids.primitives)) {
      prim.position = applyAffine(rel, prim.position)
      prim.rotation = eulerFromMatrix(mul3(relRot, eulerMatrix(prim.rotation)))
    }
    return
  }
  const N = p.views.count
  const src = isDerived(N, p.views.mirror, view) ? mirrorOf(N, view) : view
  const vp = viewProj(p, src)
  const a = projectBone(oldWorld, oldLength, vp)
  const b = projectBone(newWorld, p.skeleton.bones[boneId].length, vp)
  // Solve T(b.origin)·R(b.angle)·T(offset')·R(rotation') = T(a.origin)·R(a.angle)·T(offset)·R(rotation).
  const m = compose(rotate(-b.angle), translate(a.origin.x - b.origin.x, a.origin.y - b.origin.y), rotate(a.angle), translate(part.offset.x, part.offset.y))
  part.offset = { x: m.tx, y: m.ty }
  part.rotation = part.rotation + a.angle - b.angle
}

/** Configure skinning on a part. `bones` are the extra influencing bones; an empty list removes skinning. */
export function setPartSkin(p: Project, partId: Id, patch: { bones?: Id[]; falloff?: number; cell?: number }): void {
  const part = p.parts[partId]
  if (!part) return
  const cur = part.skin ?? { bones: [], falloff: Math.max(4, Math.round(p.canvas.size / 4)), cell: 4 }
  const bones = (patch.bones ?? cur.bones).filter((id, i, arr) => id !== part.boneId && !!p.skeleton.bones[id] && arr.indexOf(id) === i)
  const falloff = Math.max(1, patch.falloff ?? cur.falloff)
  const cell = Math.max(1, Math.min(64, Math.round(patch.cell ?? cur.cell)))
  if (bones.length === 0) delete part.skin
  else part.skin = { bones, falloff, cell }
}

function isAncestor(p: Project, maybeAncestor: Id, of: Id): boolean {
  let cur: Id | null = of
  let guard = 0
  while (cur && guard++ < 10000) {
    if (cur === maybeAncestor) return true
    cur = p.skeleton.bones[cur]?.parentId ?? null
  }
  return false
}

/** Reparent a bone. Throws on cycles. Rest pose is kept as-is (in the new parent's space). */
export function reparentBone(p: Project, id: Id, newParentId: Id | null): void {
  const bone = p.skeleton.bones[id]
  if (!bone) return
  if (newParentId === id) throw new Error('cannot parent a bone to itself')
  if (newParentId && isAncestor(p, id, newParentId)) throw new Error('cannot parent a bone to its own descendant')
  if (newParentId && !p.skeleton.bones[newParentId]) throw new Error(`no such bone ${newParentId}`)
  if (bone.parentId === newParentId) return
  if (bone.parentId) {
    const sib = p.skeleton.bones[bone.parentId].children
    sib.splice(sib.indexOf(id), 1)
  } else {
    p.skeleton.rootOrder.splice(p.skeleton.rootOrder.indexOf(id), 1)
  }
  bone.parentId = newParentId
  if (newParentId) p.skeleton.bones[newParentId].children.push(id)
  else p.skeleton.rootOrder.push(id)
}

/** Depth-first bone order (roots first, children after their parent). */
export function boneOrder(p: Project): Id[] {
  const out: Id[] = []
  const visit = (id: Id) => {
    out.push(id)
    for (const c of p.skeleton.bones[id]?.children ?? []) visit(c)
  }
  for (const r of p.skeleton.rootOrder) visit(r)
  return out
}

// ── parts ────────────────────────────────────────────────────────────────────

export interface AddPartOptions {
  name?: string
  boneId: Id
  width?: number
  height?: number
  pivot?: { x: number; y: number }
  offset?: { x: number; y: number }
  /** Rotate the image so it is upright in the front view's rest pose (default true). */
  upright?: boolean
  /** Initial image for view 1 (default: a blank image). */
  image?: PartImage
  foreshorten?: boolean
}

export function addPart(p: Project, opts: AddPartOptions): Part {
  if (!p.skeleton.bones[opts.boneId]) throw new Error(`no such bone ${opts.boneId}`)
  const w = opts.image?.width ?? opts.width ?? p.canvas.size
  const h = opts.image?.height ?? opts.height ?? p.canvas.size
  const variant: PartVariant = { id: newId(), name: 'default', images: {} }
  variant.images[1] = opts.image ?? createImage(w, h)
  const upright = opts.upright ?? true
  const part: Part = {
    id: newId(),
    name: opts.name?.trim() || uniqueName('part', Object.values(p.parts).map(x => x.name)),
    boneId: opts.boneId,
    offset: opts.offset ?? { x: 0, y: 0 },
    rotation: upright ? -restProjectedAngle(p, opts.boneId, 1) : 0,
    pivot: opts.pivot ?? { x: Math.floor(w / 2), y: h },
    foreshorten: opts.foreshorten ?? true,
    variants: { [variant.id]: variant },
    variantOrder: [variant.id],
    defaultVariant: variant.id,
  }
  p.parts[part.id] = part
  p.partOrder.push(part.id)
  return part
}

export function removePart(p: Project, id: Id): void {
  if (!p.parts[id]) return
  delete p.parts[id]
  p.partOrder.splice(p.partOrder.indexOf(id), 1)
  for (const anim of Object.values(p.animations)) delete anim.partTracks[id]
}

export function movePartOrder(p: Project, id: Id, toIndex: number): void {
  const from = p.partOrder.indexOf(id)
  if (from < 0) return
  const to = Math.max(0, Math.min(p.partOrder.length - 1, toIndex))
  p.partOrder.splice(from, 1)
  p.partOrder.splice(to, 0, id)
}

export function addVariant(p: Project, partId: Id, name?: string): PartVariant {
  const part = p.parts[partId]
  if (!part) throw new Error(`no such part ${partId}`)
  const v: PartVariant = { id: newId(), name: name?.trim() || uniqueName('variant', part.variantOrder.map(id => part.variants[id].name)), images: {} }
  part.variants[v.id] = v
  part.variantOrder.push(v.id)
  return v
}

export function removeVariant(p: Project, partId: Id, variantId: Id): void {
  const part = p.parts[partId]
  if (!part || !part.variants[variantId]) return
  if (part.variantOrder.length <= 1) throw new Error('cannot remove the last variant')
  delete part.variants[variantId]
  part.variantOrder.splice(part.variantOrder.indexOf(variantId), 1)
  if (part.defaultVariant === variantId) part.defaultVariant = part.variantOrder[0]
  for (const anim of Object.values(p.animations)) {
    const t = anim.partTracks[partId]
    if (!t) continue
    for (let i = t.variant.length - 1; i >= 0; i--) if (t.variant[i].value === variantId) t.variant.splice(i, 1)
  }
}

export function setPartImage(p: Project, partId: Id, variantId: Id, view: ViewIndex, image: PartImage | undefined): void {
  const v = p.parts[partId]?.variants[variantId]
  if (!v) throw new Error(`no such variant ${partId}/${variantId}`)
  if (image) v.images[view] = image
  else delete v.images[view]
}

export function getPartImage(p: Project, partId: Id, variantId: Id, view: ViewIndex): PartImage | undefined {
  return p.parts[partId]?.variants[variantId]?.images[view]
}

// ── animations ───────────────────────────────────────────────────────────────

export interface AddAnimationOptions { name?: string; fps?: number; frameCount?: number; loop?: boolean }

export function addAnimation(p: Project, opts: AddAnimationOptions = {}): Animation {
  const anim: Animation = {
    id: newId(),
    name: opts.name?.trim() || uniqueName('anim', p.animationOrder.map(id => p.animations[id].name)),
    fps: Math.max(0, opts.fps ?? 8),
    loop: opts.loop ?? true,
    frameCount: Math.min(MAX_FRAMES, Math.max(1, Math.round(opts.frameCount ?? 4))),
    boneTracks: {},
    partTracks: {},
  }
  p.animations[anim.id] = anim
  p.animationOrder.push(anim.id)
  return anim
}

export function removeAnimation(p: Project, id: Id): void {
  if (!p.animations[id]) return
  delete p.animations[id]
  p.animationOrder.splice(p.animationOrder.indexOf(id), 1)
}

export function setFrameCount(p: Project, animId: Id, frameCount: number): void {
  const anim = p.animations[animId]
  if (!anim) return
  anim.frameCount = Math.min(MAX_FRAMES, Math.max(1, Math.round(frameCount)))
  for (const t of Object.values(anim.boneTracks)) {
    clampKeys(t.rotation, anim.frameCount)
    clampKeys(t.translate, anim.frameCount)
    clampKeys(t.scale, anim.frameCount)
  }
  for (const t of Object.values(anim.partTracks)) {
    clampKeys(t.visible, anim.frameCount)
    clampKeys(t.variant, anim.frameCount)
  }
}

// Track creation lives with the other key helpers; re-exported here because
// callers reach for it alongside the rest of the project operations.
export { ensureBoneTrack, ensurePartTrack } from './animation'

// ── views ────────────────────────────────────────────────────────────────────

/** Change the view count / mirror mode / elevation. Images for views that no longer exist are dropped; returns warnings. */
export function setViews(p: Project, count: number, mirror: boolean, elevationDeg?: number): string[] {
  const warnings: string[] = []
  p.views.count = clampViewCount(count)
  p.views.mirror = mirror
  if (elevationDeg !== undefined && Number.isFinite(elevationDeg)) p.views.elevationDeg = Math.max(-60, Math.min(60, elevationDeg))
  const keep = new Set(authoredViews(p.views.count, p.views.mirror))
  for (const part of Object.values(p.parts)) {
    for (const v of Object.values(part.variants)) {
      for (const k of Object.keys(v.images)) {
        const view = Number(k)
        if (!keep.has(view)) {
          delete v.images[view]
          warnings.push(`Dropped image of part "${part.name}" (${v.name}) for view ${view}`)
        }
      }
    }
  }
  return warnings
}

// ── validation ───────────────────────────────────────────────────────────────

const isVec3 = (v: unknown): v is Vec3 => !!v && typeof v === 'object' && ['r', 'u', 'f'].every(k => Number.isFinite((v as Record<string, unknown>)[k]))

/** Returns a list of problems; empty when the project is consistent. */
export function validate(p: Project): string[] {
  const errs: string[] = []
  if (p.formatVersion !== FORMAT_VERSION) errs.push(`unsupported formatVersion ${p.formatVersion}`)
  if (!SPRITE_NAME_RE.test(p.spriteName)) errs.push(`spriteName "${p.spriteName}" must be 1–${MAX_SPRITE_NAME} characters: letters, digits, _ or -`)
  if (p.canvas.size < MIN_CANVAS || p.canvas.size > MAX_CANVAS) errs.push(`canvas size ${p.canvas.size} out of range`)
  if (p.views.count !== clampViewCount(p.views.count)) errs.push(`views.count ${p.views.count} out of range`)
  if (!Number.isFinite(p.views.elevationDeg)) errs.push('views.elevationDeg invalid')

  const bones = p.skeleton.bones
  const boneIds = new Set(Object.keys(bones))
  const seen = new Set<Id>()
  const visit = (id: Id, depth: number) => {
    if (depth > 10000 || seen.has(id)) { errs.push(`bone graph cycle at ${id}`); return }
    seen.add(id)
    const b = bones[id]
    if (!b) { errs.push(`missing bone ${id}`); return }
    if (!isVec3(b.rest?.position) || !isVec3(b.rest?.rotation)) errs.push(`bone ${b.name} has an invalid rest pose`)
    for (const c of b.children) {
      if (bones[c]?.parentId !== id) errs.push(`bone ${c} parent mismatch`)
      visit(c, depth + 1)
    }
  }
  for (const r of p.skeleton.rootOrder) {
    if (bones[r]?.parentId !== null) errs.push(`root ${r} has a parent`)
    visit(r, 0)
  }
  for (const id of boneIds) if (!seen.has(id)) errs.push(`bone ${id} unreachable from roots`)

  const partIds = Object.keys(p.parts)
  if (partIds.length !== p.partOrder.length || partIds.some(id => !p.partOrder.includes(id))) errs.push('partOrder is not a permutation of parts')
  const authored = new Set(authoredViews(p.views.count, p.views.mirror))
  for (const part of Object.values(p.parts)) {
    if (!bones[part.boneId]) errs.push(`part ${part.name} is on missing bone ${part.boneId}`)
    if (!part.variants[part.defaultVariant]) errs.push(`part ${part.name} default variant missing`)
    if (part.variantOrder.length !== Object.keys(part.variants).length) errs.push(`part ${part.name} variantOrder mismatch`)
    if (part.solids) {
      if (part.solids.order.length !== Object.keys(part.solids.primitives).length) errs.push(`part ${part.name} solids order mismatch`)
      for (const prim of Object.values(part.solids.primitives)) if (!isVec3(prim.position) || !isVec3(prim.size) || !isVec3(prim.rotation)) errs.push(`solid ${prim.name} has invalid vectors`)
    }
    if (part.skin) {
      for (const id of part.skin.bones) if (!bones[id]) errs.push(`part ${part.name} skin refers to missing bone ${id}`)
      if (!(part.skin.falloff > 0) || !(part.skin.cell >= 1)) errs.push(`part ${part.name} skin settings invalid`)
    }
    for (const v of Object.values(part.variants)) {
      for (const [k, img] of Object.entries(v.images)) {
        const view = Number(k)
        if (!authored.has(view)) errs.push(`part ${part.name} has an image for non-authored view ${view}`)
        if (img.pixels.length !== img.width * img.height * 4) errs.push(`part ${part.name} view ${view} pixel buffer size mismatch`)
        if (img.width > p.canvas.size || img.height > p.canvas.size) errs.push(`part ${part.name} view ${view} image larger than the canvas`)
      }
    }
  }

  const animIds = Object.keys(p.animations)
  if (animIds.length !== p.animationOrder.length || animIds.some(id => !p.animationOrder.includes(id))) errs.push('animationOrder is not a permutation of animations')
  for (const anim of Object.values(p.animations)) {
    if (anim.frameCount < 1 || anim.frameCount > MAX_FRAMES) errs.push(`animation ${anim.name} frameCount out of range`)
    if (!(anim.fps >= 0)) errs.push(`animation ${anim.name} fps invalid`)
    const checkKeys = (label: string, keys: { frame: number }[]) => {
      for (let i = 0; i < keys.length; i++) {
        const f = keys[i].frame
        if (f < 0 || f >= anim.frameCount) errs.push(`animation ${anim.name} ${label} key at frame ${f} out of range`)
        if (i > 0 && keys[i - 1].frame >= f) errs.push(`animation ${anim.name} ${label} keys not strictly sorted`)
      }
    }
    for (const [bid, t] of Object.entries(anim.boneTracks)) {
      if (!bones[bid]) errs.push(`animation ${anim.name} has a track for missing bone ${bid}`)
      checkKeys(`bone ${bid} rotation`, t.rotation)
      checkKeys(`bone ${bid} translate`, t.translate)
      checkKeys(`bone ${bid} scale`, t.scale)
    }
    for (const [pid, t] of Object.entries(anim.partTracks)) {
      if (!p.parts[pid]) errs.push(`animation ${anim.name} has a track for missing part ${pid}`)
      checkKeys(`part ${pid} visible`, t.visible)
      checkKeys(`part ${pid} variant`, t.variant)
    }
  }

  const palIds = Object.keys(p.palettes ?? {})
  if (palIds.length === 0) errs.push('project has no palette')
  if (!Array.isArray(p.paletteOrder) || palIds.length !== p.paletteOrder.length || palIds.some(id => !p.paletteOrder.includes(id))) errs.push('paletteOrder is not a permutation of palettes')
  if (!p.palettes?.[p.activePaletteId]) errs.push(`activePaletteId ${p.activePaletteId} is not a palette`)
  for (const pal of Object.values(p.palettes ?? {})) {
    if (!Array.isArray(pal.colors)) { errs.push(`palette ${pal.name} has no colour list`); continue }
    if (pal.colors.length > MAX_PALETTE) errs.push(`palette ${pal.name} has more than ${MAX_PALETTE} colours`)
    if (pal.colors.some(c => !isColor(c))) errs.push(`palette ${pal.name} has an invalid colour`)
  }
  return errs
}

const isColor = (c: unknown): c is RGBA => Array.isArray(c) && c.length === 4 && c.every(v => Number.isInteger(v) && v >= 0 && v <= 255)

/**
 * Make the palette list usable no matter what a file contained: drop broken
 * entries, keep at least one palette, and point `activePaletteId` at a real one.
 */
export function repairPalettes(p: Project): void {
  const raw = (p.palettes && typeof p.palettes === 'object' ? p.palettes : {}) as Record<Id, Partial<Palette>>
  const palettes: Record<Id, Palette> = {}
  for (const [id, pal] of Object.entries(raw)) {
    if (!pal || typeof pal !== 'object') continue
    const colors = Array.isArray(pal.colors) ? pal.colors.filter(isColor).slice(0, MAX_PALETTE).map(c => [c[0], c[1], c[2], c[3]] as const) : []
    palettes[id] = { id, name: typeof pal.name === 'string' && pal.name.trim() ? pal.name : 'Palette', colors }
  }
  const order = (Array.isArray(p.paletteOrder) ? p.paletteOrder : []).filter((id, i, a) => palettes[id] && a.indexOf(id) === i)
  for (const id of Object.keys(palettes)) if (!order.includes(id)) order.push(id)
  if (order.length === 0) {
    const pal = createPalette(PRESET_PALETTES[0].name, DEFAULT_PALETTE)
    palettes[pal.id] = pal
    order.push(pal.id)
  }
  p.palettes = palettes
  p.paletteOrder = order
  if (!palettes[p.activePaletteId]) p.activePaletteId = order[0]
}

// ── palettes ─────────────────────────────────────────────────────────────────

/** Add a palette (name made unique) after the active one; does not activate it. */
export function addPalette(p: Project, name: string, colors: readonly RGBA[]): Palette {
  const pal = createPalette(uniquePaletteName(p, name), colors)
  p.palettes[pal.id] = pal
  const at = p.paletteOrder.indexOf(p.activePaletteId)
  p.paletteOrder.splice(at < 0 ? p.paletteOrder.length : at + 1, 0, pal.id)
  return pal
}

export function duplicatePalette(p: Project, id: Id): Palette | null {
  const src = p.palettes[id]
  if (!src) return null
  return addPalette(p, `${src.name} copy`, src.colors)
}

/** Remove a palette. The last palette cannot be removed (returns false). */
export function removePalette(p: Project, id: Id): boolean {
  if (!p.palettes[id] || p.paletteOrder.length <= 1) return false
  const at = p.paletteOrder.indexOf(id)
  delete p.palettes[id]
  p.paletteOrder.splice(at, 1)
  if (p.activePaletteId === id) p.activePaletteId = p.paletteOrder[Math.min(at, p.paletteOrder.length - 1)]
  return true
}

export function setActivePalette(p: Project, id: Id): boolean {
  if (!p.palettes[id]) return false
  p.activePaletteId = id
  return true
}

export function renamePalette(p: Project, id: Id, name: string): void {
  const pal = p.palettes[id]
  if (!pal) return
  const clean = name.trim()
  if (!clean || clean === pal.name) return
  pal.name = uniquePaletteName(p, clean)
}

// ── helpers ──────────────────────────────────────────────────────────────────

export function uniqueName(base: string, existing: string[]): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`
    if (!taken.has(n)) return n
  }
}

export function touch(p: Project): void {
  p.meta.modifiedAt = new Date().toISOString()
}
