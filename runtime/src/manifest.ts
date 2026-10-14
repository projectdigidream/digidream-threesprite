/**
 * The `Atlas + JSON` export's manifest, as the editor writes it.
 *
 * Every view is a real entry in the sheet, mirrored ones included, so nothing
 * here has to be flipped at draw time. `mirrored` and `mirrorOf` say where a
 * view came from and are yours to ignore.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface ViewMeta {
  /** 1 to count. */
  index: number
  /** Camera bearing relative to the character's facing; 0 faces the viewer. */
  angleDeg: number
  mirrored: boolean
  mirrorOf: number | null
}

export interface FrameMeta {
  /** Where the picture sits in the sheet. */
  rect: Rect
  /** Where it sat on the square canvas before trimming. */
  source: Rect
  /** The feet point, relative to `rect` and normalised to its size. May fall outside 0..1. */
  pivot: { x: number; y: number }
}

export interface AnimationFrameMeta {
  index: number
  /** View number (as a string) to frame key. */
  views: Record<string, string>
}

export interface AnimationMeta {
  name: string
  fps: number
  loop: boolean
  frames: AnimationFrameMeta[]
}

export interface AtlasManifest {
  format: 'threesprite-atlas'
  version: number
  sprite: string
  canvas: { w: number; h: number }
  worldHeight: number
  /** File name of the sheet beside the manifest. */
  image: string
  /** Size of the sheet. */
  size: { w: number; h: number }
  conventions: string
  views: { count: number; mirror: boolean; list: ViewMeta[] }
  frames: Record<string, FrameMeta>
  animations: AnimationMeta[]
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(`ThreeSprite manifest: ${message}`)
    this.name = 'ManifestError'
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isRect = (v: unknown): v is Rect =>
  isObject(v) && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(v[k] as number))

/**
 * Check a parsed manifest and hand it back typed.
 *
 * This is deliberately strict about the parts a renderer depends on — the view
 * count, the frame table, every animation's frames — and quiet about the rest,
 * so a manifest from a later editor with extra keys still loads.
 */
export function parseManifest(input: unknown): AtlasManifest {
  const m = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (!isObject(m)) throw new ManifestError('expected an object')
  if (m.format !== 'threesprite-atlas') {
    throw new ManifestError(`expected format "threesprite-atlas", got ${JSON.stringify(m.format)}. Export with "Atlas + JSON".`)
  }
  if (!Number.isFinite(m.version as number)) throw new ManifestError('missing version')
  if ((m.version as number) > 1) {
    throw new ManifestError(`version ${m.version} is newer than this library understands (1)`)
  }

  const views = m.views
  if (!isObject(views) || !Number.isFinite(views.count as number) || (views.count as number) < 1) {
    throw new ManifestError('views.count is missing or not a positive number')
  }
  if (!Array.isArray(views.list)) throw new ManifestError('views.list is missing')

  if (!isObject(m.frames)) throw new ManifestError('frames table is missing')
  for (const [key, frame] of Object.entries(m.frames)) {
    if (!isObject(frame) || !isRect(frame.rect) || !isRect(frame.source) || !isObject(frame.pivot)) {
      throw new ManifestError(`frame ${JSON.stringify(key)} is missing a rect, source or pivot`)
    }
  }

  if (!Array.isArray(m.animations)) throw new ManifestError('animations are missing')
  for (const a of m.animations as unknown[]) {
    if (!isObject(a) || typeof a.name !== 'string') throw new ManifestError('an animation has no name')
    if (!Array.isArray(a.frames)) throw new ManifestError(`animation ${JSON.stringify(a.name)} has no frames`)
    for (const f of a.frames as unknown[]) {
      if (!isObject(f) || !isObject(f.views)) throw new ManifestError(`animation ${JSON.stringify(a.name)} has a frame with no views`)
      for (const [view, key] of Object.entries(f.views)) {
        if (typeof key !== 'string' || !(key in (m.frames as object))) {
          throw new ManifestError(`animation ${JSON.stringify(a.name)} frame ${f.index} view ${view} points at a frame that is not in the sheet`)
        }
      }
    }
  }

  return m as unknown as AtlasManifest
}
