/**
 * Loading a `.tsprite` straight off disk, with no export step.
 *
 * This entry point does what the editor does at export time: unzip the
 * project, compose every frame of every rotation from the 3D rig, the skinned
 * parts and the solids, then trim and pack them into one sheet. The result is
 * the same `TSpriteSheet` the `Atlas + JSON` export produces, so play-time code
 * is identical either way.
 *
 * It is a separate entry point because it costs more than the player does: it
 * carries the editor's rasterizer, a zip reader and a PNG decoder, and the work
 * happens when the sprite loads. Prefer the plain export for a shipping game
 * and this for tools, jams and editors that would rather not have a build step.
 *
 *   import { loadTsprite } from '@threesprite/runtime/tsprite'
 *
 *   const { sheet, rgba, width, height } = loadTsprite(await readFile('hero.tsprite'))
 *   const texture = uploadRGBA(rgba, width, height)
 *   const r = sheet.resolve({ animation: 'walk', time, facing, bearing })
 */
import { buildAtlas } from '../../src/core/export/atlasBuild'
import { collectFrames } from '../../src/core/io/exportBundle'
import { decodeProject } from '../../src/core/io/projectFile'
import { TSpriteSheet } from './sheet.js'

export interface LoadOptions {
  /** Only these animations, by name. Default: all of them. */
  animations?: string[]
  /** Round the sheet's height up to a power of two. */
  pow2?: boolean
  /** Called while frames are composed, for a loading bar. */
  onProgress?: (done: number, total: number) => void
}

export interface LoadedSprite {
  /** The same object `TSpriteSheet.parse` gives for an exported manifest. */
  sheet: TSpriteSheet
  /** The packed sheet as raw RGBA, ready for a texture upload. */
  rgba: Uint8ClampedArray
  width: number
  height: number
  /** The same sheet encoded as a PNG, for writing it out. */
  png: Uint8Array
  /** The manifest, if you want to save it beside the PNG. */
  manifestJson: string
  /** Anything odd about the project or its frames: empty views, repaired data. */
  warnings: string[]
}

/** Read a `.tsprite` and compose it into a sheet. */
export function loadTsprite(bytes: Uint8Array, options: LoadOptions = {}): LoadedSprite {
  const { project, warnings } = decodeProject(bytes)

  const wanted = options.animations
  const animIds = project.animationOrder.filter(id => !wanted || wanted.includes(project.animations[id].name))
  if (animIds.length === 0) {
    throw new Error(
      wanted
        ? `none of the requested animations are in this sprite (it has ${project.animationOrder.map(id => project.animations[id].name).join(', ') || 'none'})`
        : 'this sprite has no animations',
    )
  }

  const collected = collectFrames(project, animIds, options.onProgress)
  const atlas = buildAtlas({
    sprite: project.spriteName,
    canvas: project.canvas.size,
    views: { count: project.views.count, mirror: project.views.mirror },
    worldHeight: project.export.worldHeight,
    animations: collected.animations,
    frames: collected.frames,
    buffers: collected.buffers,
    pow2: options.pow2 ?? false,
  })

  return {
    sheet: TSpriteSheet.parse(atlas.manifest),
    rgba: atlas.rgba,
    width: atlas.width,
    height: atlas.height,
    png: atlas.png,
    manifestJson: atlas.json,
    warnings: [...warnings, ...atlas.warnings],
  }
}

/** The project's own name and the animations it holds, without composing anything. */
export function inspectTsprite(bytes: Uint8Array): { name: string; sprite: string; canvas: number; views: number; animations: { name: string; fps: number; loop: boolean; frameCount: number }[] } {
  const { project } = decodeProject(bytes)
  return {
    name: project.name,
    sprite: project.spriteName,
    canvas: project.canvas.size,
    views: project.views.count,
    animations: project.animationOrder.map(id => {
      const a = project.animations[id]
      return { name: a.name, fps: a.fps, loop: a.loop, frameCount: a.frameCount }
    }),
  }
}
