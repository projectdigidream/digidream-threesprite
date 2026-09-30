import { describe, it, expect } from 'vitest'
import { composeFrame } from '../../core/raster/rasterizer'
import { decodeProject, encodeProject } from '../../core/io/projectFile'
import { createImage, setPixel } from '../../domain/image'
import {
  addBone, addPart, authoredViewOf, createProject, hasPartOrderOverride, movePartOrder, partOrderFor,
  removePart, repairPartOrders, setPartOrderOverride, setViews, validate,
} from '../../domain/project'
import type { Project, RGBA } from '../../domain/types'
import { authoredViews } from '../../domain/views'
import { BLUE, RED } from '../fixtures/pixels'

/** Two 10×10 squares on one bone, both drawn in every view, red under blue. */
function stackProject(viewCount = 4, mirror = false) {
  const p = createProject({ canvasSize: 32, viewCount, mirror, starter: false })
  const bone = addBone(p, { name: 'body', length: 10 })
  const square = (c: RGBA) => {
    const img = createImage(10, 10)
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) setPixel(img, x, y, c)
    return img
  }
  const add = (c: RGBA) => {
    const part = addPart(p, { boneId: bone.id, image: square(c), pivot: { x: 5, y: 5 } })
    const v = part.variants[part.defaultVariant]
    for (const k of authoredViews(viewCount, mirror)) v.images[k] = square(c) // the same square in every view
    return part
  }
  return { p, red: add(RED), blue: add(BLUE) }
}

/** The colour at the middle of the stack, which sits on the bone root at the feet. */
function middle(p: Project, view: number): 'red' | 'blue' | 'none' {
  const px = composeFrame(p, null, 0, view)
  const i = (30 * 32 + 16) * 4
  if (px[i + 3] === 0) return 'none'
  return px[i] > px[i + 2] ? 'red' : 'blue'
}

describe('the layer order of one view', () => {
  it('follows the project until a view is given its own', () => {
    const { p } = stackProject()
    expect(partOrderFor(p, 3)).toBe(p.partOrder)
    expect(hasPartOrderOverride(p, 3)).toBe(false)
    setPartOrderOverride(p, 3, true)
    expect(hasPartOrderOverride(p, 3)).toBe(true)
    expect(partOrderFor(p, 3)).toEqual(p.partOrder) // starts from what it drew with
    expect(partOrderFor(p, 3)).not.toBe(p.partOrder) // but is its own list
    expect(partOrderFor(p, 2)).toBe(p.partOrder)
    expect(validate(p)).toEqual([])
  })

  it('stacks that view differently and leaves the others alone', () => {
    const { p, red } = stackProject()
    expect(middle(p, 1)).toBe('blue')
    expect(middle(p, 3)).toBe('blue')
    setPartOrderOverride(p, 3, true)
    movePartOrder(p, red.id, 1, 3) // red to the top, in view 3 only
    expect(middle(p, 3)).toBe('red')
    expect(middle(p, 1)).toBe('blue')
    expect(middle(p, 2)).toBe('blue')
    expect(p.partOrder[1]).not.toBe(red.id) // the project's own order untouched
  })

  it('gives way again when the override is taken off', () => {
    const { p, red } = stackProject()
    setPartOrderOverride(p, 3, true)
    movePartOrder(p, red.id, 1, 3)
    expect(middle(p, 3)).toBe('red')
    setPartOrderOverride(p, 3, false)
    expect(middle(p, 3)).toBe('blue')
    expect(p.partOrderByView).toEqual({})
  })

  it('reorders globally when the view has no order of its own', () => {
    const { p, red } = stackProject()
    movePartOrder(p, red.id, 1, 3) // asked for view 3, but view 3 follows the project
    expect(p.partOrder[1]).toBe(red.id)
    expect(middle(p, 1)).toBe('red')
    expect(middle(p, 3)).toBe('red')
  })
})

describe('mirrored views', () => {
  it('are ordered by the view they are flipped from', () => {
    const { p, red } = stackProject(8, true) // views 1–5 authored, 6–8 mirrored
    expect(authoredViewOf(p, 7)).toBe(3) // view 7 mirrors view 3
    setPartOrderOverride(p, 7, true)
    expect(hasPartOrderOverride(p, 7)).toBe(true)
    expect(hasPartOrderOverride(p, 3)).toBe(true)
    movePartOrder(p, red.id, 1, 3)
    expect(middle(p, 7)).toBe('red')
    expect(middle(p, 3)).toBe('red')
    expect(middle(p, 2)).toBe('blue')
    expect(validate(p)).toEqual([])
  })

  it('never hold an order of their own', () => {
    const { p } = stackProject(8, true)
    p.partOrderByView[7] = [...p.partOrder]
    expect(validate(p)).toEqual(['view 7 has a layer order but is not authored'])
    expect(repairPartOrders(p)).toEqual(['dropped the layer order of view 7, which is not authored'])
    expect(p.partOrderByView).toEqual({})
  })
})

describe('an override through the rest of the editor', () => {
  it('takes in a new part and lets go of a deleted one', () => {
    const { p, red, blue } = stackProject()
    setPartOrderOverride(p, 2, true)
    movePartOrder(p, red.id, 1, 2)
    const bone = p.skeleton.rootOrder[0]
    const extra = addPart(p, { boneId: bone })
    expect(partOrderFor(p, 2)).toEqual([blue.id, red.id, extra.id])
    expect(validate(p)).toEqual([])
    removePart(p, red.id)
    expect(partOrderFor(p, 2)).toEqual([blue.id, extra.id])
    expect(validate(p)).toEqual([])
  })

  it('is dropped when its view stops existing', () => {
    const { p } = stackProject(8, false)
    setPartOrderOverride(p, 7, true)
    const warnings = setViews(p, 4, false)
    expect(warnings.some(w => w.includes('View 7'))).toBe(true)
    expect(p.partOrderByView).toEqual({})
    expect(validate(p)).toEqual([])
  })

  it('is repaired rather than lost when a file disagrees', () => {
    const { p, red, blue } = stackProject()
    p.partOrderByView[2] = [blue.id, 'ghost', blue.id] // stale, duplicated, missing red
    const warnings = repairPartOrders(p)
    expect(warnings).toEqual(['repaired the layer order of view 2'])
    expect(partOrderFor(p, 2)).toEqual([blue.id, red.id])
    expect(validate(p)).toEqual([])
  })

  it('survives a round trip through the project file', () => {
    const { p, red } = stackProject()
    setPartOrderOverride(p, 3, true)
    movePartOrder(p, red.id, 1, 3)
    const { project: q, warnings } = decodeProject(encodeProject(p))
    expect(warnings).toEqual([])
    expect(q.partOrderByView[3]).toEqual(p.partOrderByView[3])
    expect(middle(q, 3)).toBe('red')
    expect(middle(q, 1)).toBe('blue')
  })

  it('a file saved before the feature simply has none', () => {
    const { p } = stackProject()
    const raw = JSON.parse(JSON.stringify(p)) as Record<string, unknown>
    delete raw.partOrderByView
    const q = raw as unknown as Project
    expect(repairPartOrders(q)).toEqual([])
    expect(q.partOrderByView).toEqual({})
  })
})
