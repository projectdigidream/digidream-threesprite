/**
 * The whole document model. Pure data: no methods, no DOM, no Tauri, so it
 * serialises to JSON directly (pixels aside) and immer can draft it.
 *
 * Coordinate conventions
 * - The CHARACTER FRAME is 3D: `r` = the character's right, `u` = up, `f` =
 *   forward (the way it faces). Units are canvas pixels; the origin is the
 *   feet point (bottom centre of the canvas). Bones and solids live here.
 * - Each view k is an orthographic camera at relative bearing (k−1)/N turns,
 *   anticlockwise seen from above (see `views.ts` / `math3.ts`). View 1 looks
 *   at the character's front, so its right hand is on screen-left.
 * - Canvas space is 2D pixels, y-down, origin top-left, square. The ground is
 *   the bottom EDGE (y = size); the feet row is the last pixel row.
 * - 2D rotations are degrees, positive = counter-clockwise ON SCREEN.
 */

export type Id = string
/** 1-based view index, 1..views.count. Matches Doom rotation digits for N=8. */
export type ViewIndex = number
export type RGBA = readonly [number, number, number, number]
export type Interp = 'linear' | 'step' | 'easeInOut'

export interface Vec2 { x: number; y: number }
/** A point or vector in the character frame. */
export interface Vec3 { r: number; u: number; f: number }

export interface Key<T> {
  frame: number
  value: T
  /** How to reach the NEXT key from this one. */
  interp: Interp
}

/** 3D rest transform in the parent's frame. Rotation is Euler degrees: `u` = yaw about up, `r` = pitch about right, `f` = roll about forward, composed Ry·Rx·Rz. */
export interface Transform3 {
  position: Vec3
  rotation: Vec3
}

export interface Bone {
  id: Id
  name: string
  parentId: Id | null
  children: Id[]
  /** Length along the bone's own +u axis, pixels. Children hang off the tip by convention; visual and for drags. */
  length: number
  /** Rest pose in the parent's frame (character frame for roots). A bone with zero rotation points up. */
  rest: Transform3
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

// ── solids (3D primitives rendered into every view) ──────────────────────────

export type PrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'cone' | 'pyramid'

export interface Primitive {
  id: Id
  name: string
  kind: PrimitiveKind
  /** Centre, in the owning bone's frame (pixels). */
  position: Vec3
  /** Extents: width (along r), height (along u), depth (along f). */
  size: Vec3
  /** Degrees: yaw about up (`u`), pitch about right (`r`), roll about forward (`f`). */
  rotation: Vec3
  color: RGBA
  visible: boolean
}

export interface SolidsShading {
  /** Number of shade tones (2–6). */
  levels: number
  /** Dark 1-px outline on silhouettes and depth steps. */
  outline: boolean
  /** Light fixed to the viewer ('view') or turning with the character ('character'). */
  lightSpace: 'view' | 'character'
}

export interface SolidsGroup {
  primitives: Record<Id, Primitive>
  order: Id[]
  shading: SolidsShading
}

export interface Part {
  id: Id
  name: string
  boneId: Id
  /**
   * Where the image's pivot sits, in the bone's PROJECTED 2D frame of each
   * view: x along the projected bone, y perpendicular (y-down canvas sense).
   */
  offset: Vec2
  /** Image rotation relative to the projected bone direction, degrees CCW on screen. */
  rotation: number
  /** The point of the image that lands on `offset`, in image pixels (edge coordinates). */
  pivot: Vec2
  /** Squash the image along the bone when the bone's projection shortens (points towards the camera). */
  foreshorten: boolean
  variants: Record<Id, PartVariant>
  variantOrder: Id[]
  defaultVariant: Id
  /** When present the part is rendered live from these 3D solids, in the bone's frame; its images are ignored. */
  solids?: SolidsGroup
  /**
   * Skinning: extra bones that deform this part's image. The image is cut
   * into a grid; each vertex follows a blend of the bones' movements weighted
   * by its distance to each bone at rest, so the image bends, stretches and
   * twists between bones in the plane of each view.
   */
  skin?: PartSkin
}

export interface PartSkin {
  /** Extra influencing bones (the part's own bone always influences it). */
  bones: Id[]
  /** Influence radius in pixels: a vertex farther than this from a bone ignores it. */
  falloff: number
  /** Grid cell size in image pixels (smaller = smoother bends, slower). */
  cell: number
}

export interface BoneTrack {
  /** Euler deltas added to the rest rotation, degrees. */
  rotation: Key<Vec3>[]
  /** Added to the rest position, parent frame. */
  translate: Key<Vec3>[]
  /** Multiplied into the bone's local frame (1 = none). */
  scale: Key<Vec3>[]
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

/** A named list of colours. Pixels store RGBA directly; palettes are a drawing aid. */
export interface Palette {
  id: Id
  name: string
  colors: RGBA[]
}

export interface Project {
  formatVersion: 3
  id: Id
  name: string
  /**
   * Stem of every exported file and the atlas manifest's `sprite` id. Letters,
   * digits, `_` and `-`, up to 32 characters. Doom-style export needs exactly
   * four of them, in upper case, but only that format cares.
   */
  spriteName: string
  canvas: { size: number }
  /**
   * `elevationDeg`: camera pitch above the horizon for every view (0 = level).
   * `depthScale`: how strongly a bone travelling towards the camera grows
   * what hangs off it — roughly the size change one canvas height of travel
   * is worth. 0 = flat, the projection every project had before the setting
   * existed. Sprites move very little in depth, so readable values are well
   * above what a real camera would give.
   */
  views: { count: number; mirror: boolean; elevationDeg: number; depthScale: number }
  palettes: Record<Id, Palette>
  paletteOrder: Id[]
  /** The palette shown in the Draw tab. Always one of `palettes`. */
  activePaletteId: Id
  skeleton: Skeleton
  parts: Record<Id, Part>
  /** Painter's order: first drawn first (bottom). */
  partOrder: Id[]
  /**
   * Views that stack their parts in their own order instead of `partOrder` —
   * an arm in front of the body from the front, behind it from the back.
   * Each entry is a permutation of `partOrder`. Only authored views may hold
   * one, since a mirrored view draws its source view's frame.
   */
  partOrderByView: Partial<Record<ViewIndex, Id[]>>
  animations: Record<Id, Animation>
  animationOrder: Id[]
  export: { worldHeight: number }
  meta: { createdAt: string; modifiedAt: string }
}

export const FORMAT_VERSION = 3 as const
export const MIN_CANVAS = 8
export const MAX_CANVAS = 256
export const MAX_FRAMES = 256
export const MAX_SPRITE_NAME = 32
/** Safe in a file name, an atlas key and a folder name. */
export const SPRITE_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/
/** Doom lump names are eight characters: four of sprite, one of frame, one of rotation. */
export const DOOM_SPRITE_NAME_RE = /^[A-Z0-9]{4}$/

export const ZERO3: Readonly<Vec3> = Object.freeze({ r: 0, u: 0, f: 0 })
export const ONE3: Readonly<Vec3> = Object.freeze({ r: 1, u: 1, f: 1 })
