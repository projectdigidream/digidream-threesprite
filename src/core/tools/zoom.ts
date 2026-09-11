import type { Vec2 } from '../../domain/types'

/** Integer zoom levels keep pixels crisp. Pinch may pass through fractions and snaps on release. */
export const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const
export const ZOOM_MIN = ZOOM_LEVELS[0]
export const ZOOM_MAX = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]

export function snapZoom(z: number): number {
  let best: number = ZOOM_LEVELS[0]
  let bestD = Infinity
  for (const l of ZOOM_LEVELS) {
    const d = Math.abs(Math.log(l / z))
    if (d < bestD) { bestD = d; best = l }
  }
  return best
}

export function nextZoom(z: number, dir: 1 | -1): number {
  const s = snapZoom(z)
  const i = ZOOM_LEVELS.indexOf(s as (typeof ZOOM_LEVELS)[number])
  const j = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + dir))
  return ZOOM_LEVELS[j]
}

/** Largest level at which the whole canvas fits with a margin. */
export function fitZoom(size: number, w: number, h: number, margin = 0.9): number {
  const limit = (Math.min(w, h) * margin) / size
  let best: number = ZOOM_LEVELS[0]
  for (const l of ZOOM_LEVELS) if (l <= limit) best = l
  return best
}

export function centeredPan(size: number, zoom: number, w: number, h: number): Vec2 {
  return { x: Math.round((w - size * zoom) / 2), y: Math.round((h - size * zoom) / 2) }
}

/** New pan that keeps the point under (cx, cy) fixed while zoom changes. */
export function zoomAbout(zoom: number, newZoom: number, pan: Vec2, cx: number, cy: number): Vec2 {
  const k = newZoom / zoom
  return { x: cx - (cx - pan.x) * k, y: cy - (cy - pan.y) * k }
}

export function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}
