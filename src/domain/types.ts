/**
 * The whole document model. Pure data: no methods, no DOM, no Tauri, so it
 * serialises to JSON directly (pixels aside) and immer can draft it.
 *
 * Coordinate conventions
 * - Canvas space is pixels, y-down, origin top-left. The canvas is square.
 *   The ground is the bottom EDGE of the canvas (y = size); the feet row is
 *   the last pixel row (y = size - 1).
 * - Rotations are degrees, positive = counter-clockwise ON SCREEN.
 * - Views: see `views.ts`. View 1 = character faces the viewer.
 */

export type Id = string
/** 1-based view index, 1..views.count. Matches Doom rotation digits for N=8. */
export type ViewIndex = number
export type RGBA = readonly [number, number, number, number]
export type Interp = 'linear' | 'step' | 'easeInOut'

export interface Vec2 { x: number; y: number }

export interface Key<T> {
  frame: number
  value: T
  /** How to reach the NEXT key from this one. */
  interp: Interp
}

export interface Transform {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
}

export interface Bone {
  id: Id
  name: string
  parentId: Id | null
  children: Id[]
  /** Drawn length of the bone along its local +x axis, pixels. Visual only. */
  length: number
  /** Rest pose in the parent's space (canvas space for roots). */
  rest: Transform
}

export interface Skeleton {
  bones: Record<Id, Bone>
  rootOrder: Id[]
}

/** Straight-alpha RGBA8, row-major, `width * height * 4` bytes. */
export interface PartImage {
  width: number
  height: number
  pixels: Uint8ClampedArray
}

export interface PartVariant {
  id: Id
  name: string
  /** One image per authored view. A missing view means "hidden in that view". */
  images: Record<number, PartImage>
}

export interface Part {
  id: Id
  name: string
  boneId: Id
  /** Where the pivot sits, in the bone's space. */
  offset: Vec2
  /** Extra rotation of the image in bone space, degrees. Lets an image stay upright on a bone that points up. */
  rotation: number
  /** The point of the image that lands on `offset`, in image pixels (edge coordinates). */
  pivot: Vec2
  variants: Record<Id, PartVariant>
  variantOrder: Id[]
  defaultVariant: Id
}

export interface BoneTrack {
  rotation: Key<number>[]
  translate: Key<Vec2>[]
  scale: Key<Vec2>[]
}

export interface PartTrack {
  visible: Key<boolean>[]
  variant: Key<Id>[]
}

export interface Animation {
  id: Id
  name: string
  /** Frames per second. 0 = hold frame 0 forever. */
  fps: number
  loop: boolean
  frameCount: number
  boneTracks: Record<Id, BoneTrack>
  partTracks: Record<Id, PartTrack>
}

export interface Project {
  formatVersion: 1
  id: Id
  name: string
  /** 4 characters, [A-Z0-9]; the Doom-style export name. */
  spriteName: string
  canvas: { size: number }
  views: { count: number; mirror: boolean }
  palette: { colors: RGBA[] }
  skeleton: Skeleton
  parts: Record<Id, Part>
  /** Painter's order: first drawn first (bottom). */
  partOrder: Id[]
  animations: Record<Id, Animation>
  animationOrder: Id[]
  export: { worldHeight: number }
  meta: { createdAt: string; modifiedAt: string }
}

export const FORMAT_VERSION = 1 as const
export const MIN_CANVAS = 8
export const MAX_CANVAS = 256
export const MAX_FRAMES = 256
export const SPRITE_NAME_RE = /^[A-Z0-9]{4}$/
