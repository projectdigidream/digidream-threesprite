/**
 * View indices and angles. Engine-agnostic.
 *
 * Angles are in TURNS, anticlockwise seen from above. `facing` is where the
 * character is heading; `bearing` is the direction from the character to the
 * camera. View k (1..N) is the picture a camera sees when standing at
 * relative bearing (k-1)/N turns. View 1: the character faces the viewer.
 *
 * At rel = 0.25 (view 3 of 8) the camera stands at the character's LEFT, so
 * the character appears facing screen-left. That is the classic Doom rotation
 * convention, so Doom-style exports need no remapping.
 */
import type { ViewIndex } from './types'

export const MIN_VIEWS = 1
export const MAX_VIEWS = 64
export const VIEW_PRESETS = [1, 4, 6, 8, 12, 16, 24, 32] as const

export const mod1 = (t: number): number => ((t % 1) + 1) % 1

export function clampViewCount(n: number): number {
  if (!Number.isFinite(n)) return 8
  return Math.min(MAX_VIEWS, Math.max(MIN_VIEWS, Math.round(n)))
}

/** Which view a camera at `bearingTurns` sees of a character heading `facingTurns`. */
export function viewIndex(N: number, facingTurns: number, bearingTurns: number): ViewIndex {
  return (Math.round(mod1(bearingTurns - facingTurns) * N) % N) + 1
}

/** Relative camera bearing of view k, in turns. */
export function viewAngleTurns(N: number, k: ViewIndex): number {
  return (k - 1) / N
}

export function viewAngleDeg(N: number, k: ViewIndex): number {
  return ((k - 1) * 360) / N
}

/** The view that is the horizontal mirror of view k. 1 is its own mirror; so is N/2+1 for even N. */
export function mirrorOf(N: number, k: ViewIndex): ViewIndex {
  return ((N - (k - 1)) % N) + 1
}

export function authoredViewCount(N: number, mirror: boolean): number {
  return mirror ? Math.floor(N / 2) + 1 : N
}

/** Views the artist draws. With mirroring, the rest are derived by flipping. */
export function authoredViews(N: number, mirror: boolean): ViewIndex[] {
  const n = authoredViewCount(N, mirror)
  const out: ViewIndex[] = []
  for (let k = 1; k <= Math.min(n, N); k++) out.push(k)
  return out
}

export function allViews(N: number): ViewIndex[] {
  const out: ViewIndex[] = []
  for (let k = 1; k <= N; k++) out.push(k)
  return out
}

export function isDerived(N: number, mirror: boolean, k: ViewIndex): boolean {
  return mirror && k > authoredViewCount(N, mirror)
}

/** The authored view whose pixels produce view k (k itself when authored). */
export function sourceView(N: number, mirror: boolean, k: ViewIndex): ViewIndex {
  return isDerived(N, mirror, k) ? mirrorOf(N, k) : k
}

/** Human label: "Front", "Left side", "Back-right 225°"… */
export function viewLabel(N: number, k: ViewIndex): string {
  const rel = viewAngleTurns(N, k)
  const deg = Math.round(viewAngleDeg(N, k) * 100) / 100
  const eps = 1e-9
  if (Math.abs(rel) < eps) return 'Front'
  if (Math.abs(rel - 0.5) < eps) return 'Back'
  if (Math.abs(rel - 0.25) < eps) return 'Left side'
  if (Math.abs(rel - 0.75) < eps) return 'Right side'
  let name: string
  if (rel < 0.25) name = 'Front-left'
  else if (rel < 0.5) name = 'Back-left'
  else if (rel < 0.75) name = 'Back-right'
  else name = 'Front-right'
  return `${name} ${deg}°`
}
