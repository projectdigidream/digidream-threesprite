/**
 * Project-level operations for solids parts. Solids render live, so these
 * only edit the description; the compositor picks the change up everywhere.
 */
import { evalPose, projectBone, viewProj } from './pose'
import { addPart } from './project'
import { createPrimitive, createSolidsGroup, renderSolids } from './solids'
import type { Id, Part, Primitive, PrimitiveKind, Project, RGBA, SolidsShading } from './types'
import { authoredViews } from './views'

/** A new solids part attached to `boneId`. Its primitives live in the bone's frame. */
export function addSolidsPart(p: Project, boneId: Id, name = 'solids'): Part {
  const part = addPart(p, { boneId, name, width: 1, height: 1, pivot: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, upright: false })
  part.variants[part.defaultVariant].images = {}
  part.solids = createSolidsGroup()
  return part
}

export function addPrimitive(p: Project, partId: Id, kind: PrimitiveKind, color: RGBA, size?: number): Primitive {
  const part = p.parts[partId]
  if (!part?.solids) throw new Error('not a solids part')
  const prim = createPrimitive(kind, color, size ?? Math.max(4, Math.round(p.canvas.size / 4)))
  const existing = part.solids.order.map(id => part.solids!.primitives[id].name)
  let n = prim.name
  for (let i = 2; existing.includes(n); i++) n = `${prim.name} ${i}`
  prim.name = n
  part.solids.primitives[prim.id] = prim
  part.solids.order.push(prim.id)
  return prim
}

export function removePrimitive(p: Project, partId: Id, primId: Id): void {
  const g = p.parts[partId]?.solids
  if (!g || !g.primitives[primId]) return
  delete g.primitives[primId]
  g.order.splice(g.order.indexOf(primId), 1)
}

export function duplicatePrimitive(p: Project, partId: Id, primId: Id): Primitive | null {
  const g = p.parts[partId]?.solids
  const src = g?.primitives[primId]
  if (!g || !src) return null
  const copy: Primitive = JSON.parse(JSON.stringify(src))
  copy.id = createPrimitive(src.kind, src.color).id
  copy.name = `${src.name} copy`
  copy.position = { ...src.position, r: src.position.r + Math.max(2, Math.round(src.size.r / 2)) }
  g.primitives[copy.id] = copy
  g.order.splice(g.order.indexOf(primId) + 1, 0, copy.id)
  return copy
}

export function updatePrimitive(p: Project, partId: Id, primId: Id, fn: (prim: Primitive) => void): void {
  const prim = p.parts[partId]?.solids?.primitives[primId]
  if (prim) fn(prim)
}

export function updateShading(p: Project, partId: Id, patch: Partial<SolidsShading>): void {
  const g = p.parts[partId]?.solids
  if (g) Object.assign(g.shading, patch)
}

export function movePrimitiveOrder(p: Project, partId: Id, primId: Id, dir: 1 | -1): void {
  const g = p.parts[partId]?.solids
  if (!g) return
  const i = g.order.indexOf(primId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= g.order.length) return
  g.order.splice(i, 1)
  g.order.splice(j, 0, primId)
}

/**
 * Bake: render the rest pose of every authored view into ordinary images and
 * drop the 3D description, so the part can be painted by hand. The baked
 * images are canvas-sized and placed to map 1:1 in every view when the bone's
 * projection is the same in all views (an upright bone at the origin).
 */
export function convertSolidsToPixels(p: Project, partId: Id): void {
  const part = p.parts[partId]
  if (!part?.solids) return
  const world = evalPose(p.skeleton, null, 0).get(part.boneId)
  const bone = p.skeleton.bones[part.boneId]
  if (!world || !bone) return
  const images: Record<number, ReturnType<typeof renderSolids>> = {}
  for (const k of authoredViews(p.views.count, p.views.mirror)) images[k] = renderSolids(part.solids, world, viewProj(p, k))
  part.variants[part.defaultVariant].images = images
  // identity mapping in view 1: T(origin)·R(angle)·T(offset)·R(rot)·T(−pivot) = I
  const bp = projectBone(world, bone.length, viewProj(p, 1))
  part.rotation = -bp.angle
  part.pivot = { x: 0, y: 0 }
  const rad = (-bp.angle * Math.PI) / 180 // offset = R(−angle)·(−origin)
  const ox = -bp.origin.x, oy = -bp.origin.y
  part.offset = { x: Math.cos(rad) * ox + Math.sin(rad) * oy, y: -Math.sin(rad) * ox + Math.cos(rad) * oy }
  part.foreshorten = false
  delete part.solids
}
