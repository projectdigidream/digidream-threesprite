import type { Animation, Interp, Key, Vec2, Vec3 } from './types'

/** Which frame is showing `seconds` into the animation. Pure, shared by playback and export. */
export function frameAt(anim: Pick<Animation, 'fps' | 'frameCount' | 'loop'>, seconds: number): number {
  const n = Math.max(1, anim.frameCount | 0)
  if (n <= 1 || !(anim.fps > 0) || !(seconds > 0)) return 0
  const f = Math.floor(seconds * anim.fps)
  return anim.loop ? f % n : Math.min(f, n - 1)
}

export const lerpNumber = (a: number, b: number, u: number): number => a + (b - a) * u
export const lerpVec2 = (a: Vec2, b: Vec2, u: number): Vec2 => ({ x: lerpNumber(a.x, b.x, u), y: lerpNumber(a.y, b.y, u) })
export const lerpVec3 = (a: Vec3, b: Vec3, u: number): Vec3 => ({ r: lerpNumber(a.r, b.r, u), u: lerpNumber(a.u, b.u, u), f: lerpNumber(a.f, b.f, u) })
export const stepOnly = <T,>(a: T): T => a
export const smoothstep = (u: number): number => u * u * (3 - 2 * u)

/**
 * Sample a sorted key list at `frame`.
 * No keys → identity. Before the first / after the last → clamp. Between two
 * keys → the FIRST key's interp decides: step holds, linear lerps, easeInOut
 * lerps through smoothstep. `lerp` is never called for step.
 */
export function sampleTrack<T>(keys: readonly Key<T>[], frame: number, identity: T, lerp: (a: T, b: T, u: number) => T): T {
  const n = keys.length
  if (n === 0) return identity
  if (frame <= keys[0].frame) return keys[0].value
  if (frame >= keys[n - 1].frame) return keys[n - 1].value
  // binary search for the last key with key.frame <= frame
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keys[mid].frame <= frame) lo = mid
    else hi = mid - 1
  }
  const k0 = keys[lo]
  const k1 = keys[lo + 1]
  if (k0.interp === 'step') return k0.value
  const span = k1.frame - k0.frame
  let u = span > 0 ? (frame - k0.frame) / span : 1
  if (k0.interp === 'easeInOut') u = smoothstep(u)
  return lerp(k0.value, k1.value, u)
}

/** Insert or replace the key at `frame`, keeping the list sorted. Returns the key. */
export function setKey<T>(keys: Key<T>[], frame: number, value: T, interp: Interp = 'linear'): Key<T> {
  let i = 0
  while (i < keys.length && keys[i].frame < frame) i++
  if (i < keys.length && keys[i].frame === frame) {
    keys[i].value = value
    return keys[i]
  }
  const key: Key<T> = { frame, value, interp }
  keys.splice(i, 0, key)
  return key
}

export function getKey<T>(keys: readonly Key<T>[], frame: number): Key<T> | undefined {
  return keys.find(k => k.frame === frame)
}

export function removeKey<T>(keys: Key<T>[], frame: number): boolean {
  const i = keys.findIndex(k => k.frame === frame)
  if (i < 0) return false
  keys.splice(i, 1)
  return true
}

/** Move a key to another frame, replacing whatever was there. */
export function moveKey<T>(keys: Key<T>[], from: number, to: number): boolean {
  if (from === to) return true
  const i = keys.findIndex(k => k.frame === from)
  if (i < 0) return false
  const [k] = keys.splice(i, 1)
  const j = keys.findIndex(x => x.frame === to)
  if (j >= 0) keys.splice(j, 1)
  setKey(keys, to, k.value, k.interp)
  return true
}

/** Drop keys at or beyond the frame count (after shrinking an animation). */
export function clampKeys<T>(keys: Key<T>[], frameCount: number): void {
  for (let i = keys.length - 1; i >= 0; i--) if (keys[i].frame >= frameCount) keys.splice(i, 1)
}
