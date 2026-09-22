/**
 * Builds the `.tsprite` the runtime library's loader tests read.
 *
 * Writing it here rather than checking in a file made by hand means the
 * fixture is always a project this codebase would actually save. Refresh it
 * with `THREESPRITE_WRITE_FIXTURES=1 pnpm test:run`.
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { setKey } from '../../domain/animation'
import { createImage, setPixel } from '../../domain/image'
import { addAnimation, addBone, addPart, createProject, ensureBoneTrack, setPartImage, validate } from '../../domain/project'
import { decodeProject, encodeProject } from '../../core/io/projectFile'
import { composeFrame } from '../../core/raster/rasterizer'
import { RED } from '../fixtures/pixels'

const FIXTURE = 'runtime/test/fixtures/sample.tsprite'

describe('the .tsprite fixture for the runtime loader', () => {
  const p = createProject({ name: 'Fixture', spriteName: 'FIXT', canvasSize: 16, viewCount: 4, mirror: true, starter: false })
  const body = addBone(p, { name: 'body', length: 10 })
  const arm = addBone(p, { name: 'arm', parentId: body.id, length: 6, rest: { position: { r: 0, u: 10, f: 0 }, rotation: { r: 0, u: 0, f: -60 } } })

  // every authored view needs its own art; view 4 is the mirror of view 2
  const authored = [1, 2, 3] as const

  const torso = addPart(p, { name: 'torso', boneId: body.id, width: 8, height: 12, pivot: { x: 4, y: 12 } })
  for (const v of authored) {
    const img = createImage(8, 12)
    for (let y = 0; y < 12; y++) for (let x = 1; x < 7; x++) setPixel(img, x, y, [60, 90, 200 - v * 20, 255])
    setPartImage(p, torso.id, torso.defaultVariant, v, img)
  }

  const hand = addPart(p, { name: 'hand', boneId: arm.id, width: 4, height: 4, pivot: { x: 2, y: 4 } })
  for (const v of authored) {
    const img = createImage(4, 4)
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setPixel(img, x, y, RED)
    setPartImage(p, hand.id, hand.defaultVariant, v, img)
  }

  const walk = addAnimation(p, { name: 'walk', fps: 10, frameCount: 2, loop: true })
  setKey(ensureBoneTrack(walk, arm.id).rotation, 1, { r: 0, u: 0, f: 50 })

  it('is a valid project whose frames have pixels in every view', () => {
    expect(validate(p)).toEqual([])
    for (let v = 1; v <= p.views.count; v++) {
      for (let f = 0; f < 2; f++) {
        const px = composeFrame(p, walk.id, f, v)
        expect(px.some((_, i) => i % 4 === 3 && px[i] > 0), `view ${v} frame ${f} draws something`).toBe(true)
      }
    }
  })

  it('round-trips through the project file', () => {
    const { project, warnings } = decodeProject(encodeProject(p))
    expect(warnings).toEqual([])
    expect(project.animationOrder).toHaveLength(1)
    expect(project.partOrder).toHaveLength(2)

    if (process.env.THREESPRITE_WRITE_FIXTURES) {
      writeFileSync(FIXTURE, encodeProject(p))
      console.log(`wrote ${FIXTURE}`)
    }
  })
})
