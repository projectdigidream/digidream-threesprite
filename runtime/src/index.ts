/**
 * Play ThreeSprite sprites in any engine.
 *
 * Export a project as `Atlas + JSON`, load the sheet PNG however your engine
 * loads images, and hand the manifest to `TSpriteSheet.parse`. Each tick, say
 * where the camera is and how far into the animation you are, and `resolve`
 * returns the rectangle to cut from the sheet and the feet to hang it from.
 *
 *   import { TSpriteSheet, turnsFromGround } from '@threesprite/runtime'
 *
 *   const sheet = TSpriteSheet.parse(await (await fetch('HERO.json')).json())
 *   const image = await loadImage(sheet.image)
 *
 *   const bearing = turnsFromGround(camera.x - actor.x, camera.z - actor.z)
 *   const r = sheet.resolve({ animation: 'walk', time: t, facing: actor.facing, bearing })
 *   drawResolved(ctx, image, r, screenX, groundY, { scale: 3 })
 *
 * No dependencies, no renderer, no assumptions about your loop.
 */
export {
  TAU,
  degreesFromTurns,
  groundFromTurns,
  mod1,
  radiansFromTurns,
  relativeTurns,
  turnsFromDegrees,
  turnsFromGround,
  turnsFromRadians,
  turnsFromYawDegrees,
  turnsFromYawRadians,
  viewAngleTurns,
  viewFor,
  type Ground,
} from './angles.js'

export { durationSeconds, frameAt, isFinished, Playhead, type Timing } from './playback.js'

export {
  ManifestError,
  parseManifest,
  type AnimationFrameMeta,
  type AnimationMeta,
  type AtlasManifest,
  type FrameMeta,
  type Rect,
  type ViewMeta,
} from './manifest.js'

export { TSpriteSheet, type Animation, type Look, type Resolved, type ResolveRequest } from './sheet.js'

export { drawResolved, placeResolved, type DrawOptions, type DrawTarget } from './draw.js'
