import { mod1, relativeTurns, viewAngleTurns, viewFor } from './angles.js'
import { parseManifest, type AnimationMeta, type AtlasManifest, type FrameMeta, type Rect } from './manifest.js'
import { durationSeconds, frameAt, isFinished, type Timing } from './playback.js'

/** One animation, ready to sample. */
export interface Animation extends Timing {
  name: string
  /** Seconds for one pass; 0 when it never advances. */
  duration: number
}

export interface Resolved {
  /** Key into the manifest's frame table, e.g. `walk/3/v2`. */
  key: string
  /** 1 to viewCount. */
  view: number
  frame: number
  /** Where to cut from the sheet. */
  rect: Rect
  /** Where the picture sat on the square canvas before trimming. */
  source: Rect
  /** The feet point inside `rect`, in pixels. Subtract it from where you want the feet to land. */
  pivot: { x: number; y: number }
  /** The same point normalised to `rect`; may fall outside 0..1 when trimming cut past the feet. */
  pivotNormalised: { x: number; y: number }
}

export interface Look {
  /** Where the character is heading, in turns. Defaults to 0. */
  facing?: number
  /** Direction from the character to the camera, in turns. Defaults to 0. */
  bearing?: number
  /** Give this instead of facing and bearing when you already know the difference. */
  relative?: number
}

export interface ResolveRequest extends Look {
  /** Animation name. Defaults to the first one. */
  animation?: string
  /** Seconds into the animation. Ignored when `frame` is given. */
  time?: number
  /** An exact frame, clamped into range. */
  frame?: number
}

/**
 * A loaded `Atlas + JSON` export: the sheet's geometry plus the rules for
 * picking what to draw.
 *
 * Nothing here touches images or a renderer. Load the sheet PNG however your
 * engine likes — its file name is `image` — and feed `resolve()` the camera
 * direction and the time.
 */
export class TSpriteSheet {
  /** Parse a manifest, from an object or a JSON string. Throws `ManifestError` on bad input. */
  static parse(input: unknown): TSpriteSheet {
    return new TSpriteSheet(parseManifest(input))
  }

  private readonly byName = new Map<string, { meta: AnimationMeta; animation: Animation }>()

  private constructor(readonly manifest: AtlasManifest) {
    for (const meta of manifest.animations) {
      const timing: Timing = { fps: meta.fps, frameCount: meta.frames.length, loop: meta.loop }
      this.byName.set(meta.name, {
        meta,
        animation: { name: meta.name, ...timing, duration: durationSeconds(timing) },
      })
    }
  }

  get sprite(): string {
    return this.manifest.sprite
  }

  /** File name of the sheet PNG, beside the manifest. */
  get image(): string {
    return this.manifest.image
  }

  /** Size of the sheet in pixels. */
  get size(): { w: number; h: number } {
    return this.manifest.size
  }

  /** The square canvas every frame was drawn on. */
  get canvas(): { w: number; h: number } {
    return this.manifest.canvas
  }

  /** Height of the character in world units, for scaling the quad. */
  get worldHeight(): number {
    return this.manifest.worldHeight
  }

  get viewCount(): number {
    return this.manifest.views.count
  }

  get animationNames(): string[] {
    return [...this.byName.keys()]
  }

  animation(name?: string): Animation | undefined {
    const entry = name === undefined ? this.byName.values().next().value : this.byName.get(name)
    return entry?.animation
  }

  frame(key: string): FrameMeta | undefined {
    return this.manifest.frames[key]
  }

  /** The view a camera sees, from 1 to `viewCount`. */
  viewFor(look: Look): number {
    const relative = look.relative ?? relativeTurns(look.bearing ?? 0, look.facing ?? 0)
    return viewFor(this.viewCount, relative)
  }

  /** The relative bearing a view is drawn at, in turns. */
  viewAngle(view: number): number {
    return viewAngleTurns(this.viewCount, view)
  }

  /** How far the camera is from the centre of the view it is being shown, in turns (0 to 0.5). */
  viewError(look: Look): number {
    const relative = mod1(look.relative ?? relativeTurns(look.bearing ?? 0, look.facing ?? 0))
    const off = mod1(relative - this.viewAngle(this.viewFor(look)))
    return Math.min(off, 1 - off)
  }

  /** Whether a one-shot animation has run out by `seconds`. */
  finished(animation: string | undefined, seconds: number): boolean {
    const a = this.animation(animation)
    return a ? isFinished(a, seconds) : false
  }

  /**
   * Everything needed to draw one sprite this tick.
   *
   * Returns undefined only when the animation is not in the sheet, or when the
   * frame it picked has no picture for that view, which an export never
   * produces but a hand-edited manifest might.
   */
  resolve(request: ResolveRequest = {}): Resolved | undefined {
    const entry = request.animation === undefined ? this.byName.values().next().value : this.byName.get(request.animation)
    if (!entry) return undefined
    const { meta, animation } = entry

    const frameIndex =
      request.frame !== undefined
        ? Math.min(Math.max(0, Math.floor(request.frame)), Math.max(0, meta.frames.length - 1))
        : frameAt(animation, request.time ?? 0)

    const view = this.viewFor(request)
    const frameMeta = meta.frames[frameIndex]
    const key = frameMeta?.views[String(view)]
    if (key === undefined) return undefined
    const f = this.manifest.frames[key]
    if (!f) return undefined

    return {
      key,
      view,
      frame: frameIndex,
      rect: f.rect,
      source: f.source,
      pivot: { x: f.pivot.x * f.rect.w, y: f.pivot.y * f.rect.h },
      pivotNormalised: f.pivot,
    }
  }
}
