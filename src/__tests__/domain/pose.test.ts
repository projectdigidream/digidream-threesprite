import { describe, it, expect } from 'vitest'
import { setKey } from '../../domain/animation'
import { evalPose, partMatrix, restWorldRotation } from '../../domain/pose'
import { addAnimation, addBone, addPart, createProject, ensureBoneTrack } from '../../domain/project'
import { apply } from '../../domain/transform'

describe('evalPose', () => {
  it('chains a child bone off its parent', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { rest: { x: 16, y: 32, rotation: 90 }, length: 10 })
    const child = addBone(p, { parentId: root.id, rest: { x: 10, y: 0, rotation: -90 }, length: 5 })
    const pose = evalPose(p.skeleton, null, 0)
    const rootTip = apply(pose.get(root.id)!, 10, 0)
    expect(rootTip.x).toBeCloseTo(16)
    expect(rootTip.y).toBeCloseTo(22) // 10 up from the ground line
    const childOrigin = apply(pose.get(child.id)!, 0, 0)
    expect(childOrigin.x).toBeCloseTo(16)
    expect(childOrigin.y).toBeCloseTo(22)
    const childTip = apply(pose.get(child.id)!, 5, 0)
    expect(childTip.x).toBeCloseTo(21) // rotated back to pointing right
    expect(childTip.y).toBeCloseTo(22)
    expect(restWorldRotation(p.skeleton, child.id)).toBe(0)
  })

  it('applies animation keys on top of the rest pose', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { rest: { x: 16, y: 32, rotation: 0 }, length: 10 })
    const anim = addAnimation(p, { frameCount: 4 })
    const t = ensureBoneTrack(anim, root.id)
    setKey(t.rotation, 0, 0)
    setKey(t.rotation, 2, 90)
    setKey(t.translate, 0, { x: 0, y: 0 })
    setKey(t.translate, 2, { x: 4, y: 0 })
    const at1 = evalPose(p.skeleton, anim, 1).get(root.id)!
    const tip = apply(at1, 10, 0)
    // rotation 45, translate (2,0): tip = (16+2 + 10cos45, 32 - 10sin45)
    expect(tip.x).toBeCloseTo(18 + 10 * Math.SQRT1_2)
    expect(tip.y).toBeCloseTo(32 - 10 * Math.SQRT1_2)
  })

  it('a starter part maps its image 1:1 onto the canvas in the rest pose', () => {
    const p = createProject({ canvasSize: 16 })
    const partId = p.partOrder[0]
    const part = p.parts[partId]
    const pose = evalPose(p.skeleton, null, 0)
    const m = partMatrix(pose.get(part.boneId)!, part)
    const tl = apply(m, 0, 0)
    const br = apply(m, 16, 16)
    expect(tl.x).toBeCloseTo(0); expect(tl.y).toBeCloseTo(0)
    expect(br.x).toBeCloseTo(16); expect(br.y).toBeCloseTo(16)
  })

  it('addPart with upright keeps images upright on rotated bones', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const a = addBone(p, { rest: { x: 0, y: 0, rotation: 30 } })
    const b = addBone(p, { parentId: a.id, rest: { x: 0, y: 0, rotation: 45 } })
    const part = addPart(p, { boneId: b.id, width: 4, height: 4, pivot: { x: 0, y: 0 } })
    expect(part.rotation).toBe(-75)
    const pose = evalPose(p.skeleton, null, 0)
    const m = partMatrix(pose.get(b.id)!, part)
    const right = apply(m, 1, 0)
    expect(right.x).toBeCloseTo(1)
    expect(right.y).toBeCloseTo(0)
  })
})
