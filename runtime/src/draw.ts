/**
 * A convenience for 2D canvas renderers. Engines with their own sprite
 * batching want `Resolved` instead and can ignore this file.
 */
import type { Resolved } from './sheet.js'

/** The slice of a 2D context this uses, so the library needs no DOM types. */
export interface DrawTarget {
  drawImage(
    image: never,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void
}

export interface DrawOptions {
  /** Pixels per source pixel. Defaults to 1. */
  scale?: number
  /** Mirror horizontally about the feet. The caller flips the context; this only moves the quad. */
  flipX?: boolean
}

/**
 * Draw a resolved frame with its feet at (x, y), which is the point the editor
 * anchors every view to.
 *
 * Rounding to whole pixels keeps pixel art crisp; turn off image smoothing on
 * the context as well.
 */
export function drawResolved(
  ctx: DrawTarget,
  image: unknown,
  r: Resolved,
  x: number,
  y: number,
  options: DrawOptions = {},
): void {
  const scale = options.scale ?? 1
  const w = r.rect.w * scale
  const h = r.rect.h * scale
  const offsetX = options.flipX ? (r.rect.w - r.pivot.x) * scale : r.pivot.x * scale
  const dx = Math.round(x - offsetX)
  const dy = Math.round(y - r.pivot.y * scale)
  ctx.drawImage(image as never, r.rect.x, r.rect.y, r.rect.w, r.rect.h, dx, dy, w, h)
}

/**
 * Where a resolved frame lands when its feet sit at (x, y): the destination
 * rectangle, for engines that position quads themselves.
 */
export function placeResolved(r: Resolved, x: number, y: number, scale = 1): { x: number; y: number; w: number; h: number } {
  return {
    x: x - r.pivot.x * scale,
    y: y - r.pivot.y * scale,
    w: r.rect.w * scale,
    h: r.rect.h * scale,
  }
}
