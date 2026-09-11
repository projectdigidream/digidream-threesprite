import { describe, it, expect } from 'vitest'
import { setKey } from '../../domain/animation'
import { evalPose, partMatrix, projectBone, restProjectedAngle, viewProj } from '../../domain/pose'
import { addAnimation, addBone, addPart, createProject, ensureBoneTrack } from '../../domain/project'
import { apply } from '../../domain/transform'

describe('evalPose / projectBone', () => {
  it('chains a child bone off its parent and projects into the front view', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { length: 10 }) // at the feet, pointing up
    const child = addBone(p, { parentId: root.id, rest: { position: { u: 10 }, rotation: { f: -90 } }, length: 5 }) // from the tip, pointing screen-right
    const pose = evalPose(p.skeleton, null, 0)
    const vp = viewProj(p, 1)
    const rp = projectBone(pose.get(root.id)!, 10, vp)
    expect(rp.origin).toEqual({ x: 16, y: 32 })
    expect(rp.tip.x).toBeCloseTo(16)
    expect(rp.tip.y).toBeCloseTo(22)
    expect(rp.angle).toBeCloseTo(90)
    const cp = projectBone(pose.get(child.id)!, 5, vp)
    expect(cp.origin.x).toBeCloseTo(16)
    expect(cp.origin.y).toBeCloseTo(22)
    expect(cp.tip.x).toBeCloseTo(21)
    expect(cp.tip.y).toBeCloseTo(22)
    expect(cp.angle).toBeCloseTo(0)
    expect(restProjectedAngle(p, child.id, 1)).toBeCloseTo(0)
  })

  it('a bone along the character\'s right projects differently in every view', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { length: 10 })
    const arm = addBone(p, { parentId: root.id, rest: { position: { u: 10 }, rotation: { f: 90 } }, length: 8 }) // points to the character's right (+r)
    const pose = evalPose(p.skeleton, null, 0)
    const w = pose.get(arm.id)!
    const front = projectBone(w, 8, viewProj(p, 1))
    expect(front.tip.x).toBeCloseTo(16 - 8) // screen-left
    expect(Math.abs(front.angle)).toBeCloseTo(180)
    const back = projectBone(w, 8, viewProj(p, 5))
    expect(back.tip.x).toBeCloseTo(16 + 8) // screen-right
    expect(back.angle).toBeCloseTo(0)
    const side = projectBone(w, 8, viewProj(p, 3), 45) // pointing at the camera: zero length, fallback angle
    expect(side.length).toBeCloseTo(0)
    expect(side.angle).toBe(45)
  })

  it('applies animation keys on top of the rest pose', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { length: 10 })
    const anim = addAnimation(p, { frameCount: 4 })
    const t = ensureBoneTrack(anim, root.id)
    setKey(t.rotation, 0, { r: 0, u: 0, f: 0 })
    setKey(t.rotation, 2, { r: 0, u: 0, f: -90 })
    setKey(t.translate, 0, { r: 0, u: 0, f: 0 })
    setKey(t.translate, 2, { r: -4, u: 0, f: 0 })
    const at1 = projectBone(evalPose(p.skeleton, anim, 1).get(root.id)!, 10, viewProj(p, 1))
    // roll −45 (CW on screen) and moved 2 px screen-right: tip = (16+2 + 10 sin45, 32 − 10 cos45)
    expect(at1.origin.x).toBeCloseTo(18)
    expect(at1.tip.x).toBeCloseTo(18 + 10 * Math.SQRT1_2)
    expect(at1.tip.y).toBeCloseTo(32 - 10 * Math.SQRT1_2)
  })

  it('a starter part maps its image 1:1 onto the canvas in every view', () => {
    const p = createProject({ canvasSize: 16 })
    const part = p.parts[p.partOrder[0]]
    const bone = p.skeleton.bones[part.boneId]
    for (const view of [1, 2, 3, 5]) {
      const w = evalPose(p.skeleton, null, 0).get(bone.id)!
      const rp = projectBone(w, bone.length, viewProj(p, view))
      const m = partMatrix(rp, rp, part)
      const tl = apply(m, 0, 0)
      const br = apply(m, 16, 16)
      expect(tl.x).toBeCloseTo(0); expect(tl.y).toBeCloseTo(0)
      expect(br.x).toBeCloseTo(16); expect(br.y).toBeCloseTo(16)
    }
  })

  it('foreshortening squashes a part along a bone that turns towards the camera', () => {
    const p = createProject({ canvasSize: 32, starter: false })
    const root = addBone(p, { length: 10 })
    const arm = addBone(p, { parentId: root.id, rest: { position: { u: 10 }, rotation: { f: 90 } }, length: 8 })
    const part = addPart(p, { boneId: arm.id, width: 8, height: 4, pivot: { x: 0, y: 2 }, upright: false })
    const anim = addAnimation(p, { frameCount: 2 })
    setKey(ensureBoneTrack(anim, arm.id).rotation, 1, { r: 0, u: 60, f: 0 }) // yaw the arm forward
    const vp = viewProj(p, 1)
    const restW = evalPose(p.skeleton, null, 0).get(arm.id)!
    const curW = evalPose(p.skeleton, anim, 1).get(arm.id)!
    const rp = projectBone(restW, 8, vp)
    const cp = projectBone(curW, 8, vp, rp.angle)
    expect(cp.length).toBeCloseTo(8 * Math.cos(Math.PI / 3))
    const m = partMatrix(rp, cp, part)
    const along = apply(m, 8, 2)
    const origin = apply(m, 0, 2)
    expect(Math.hypot(along.x - origin.x, along.y - origin.y)).toBeCloseTo(4)
    part.foreshorten = false
    const m2 = partMatrix(rp, cp, part)
    const along2 = apply(m2, 8, 2)
    const origin2 = apply(m2, 0, 2)
    expect(Math.hypot(along2.x - origin2.x, along2.y - origin2.y)).toBeCloseTo(8)
  })
})
