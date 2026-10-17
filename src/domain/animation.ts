import type { Animation, BoneTrack, Id, Interp, Key, PartTrack, Vec2, Vec3 } from './types'

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

/**
 * A switch track (visibility, variant): the value of the last key at or
 * before `frame`, and `before` until the first key. Unlike a motion track it
 * does not reach back: a switch keyed at frame 3 leaves frames 0–2 as they
 * were.
 */
export function sampleSwitch<T>(keys: readonly Key<T>[], frame: number, before: T): T {
  let value = before
  for (const k of keys) {
    if (k.frame > frame) break
    value = k.value
  }
  return value
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

// ── timeline rows ────────────────────────────────────────────────────────────

export function ensureBoneTrack(anim: Animation, boneId: Id): BoneTrack {
  return (anim.boneTracks[boneId] ??= { rotation: [], translate: [], scale: [] })
}

export function ensurePartTrack(anim: Animation, partId: Id): PartTrack {
  return (anim.partTracks[partId] ??= { visible: [], variant: [] })
}

/** A timeline row is one bone or one part; the diamond at a frame stands for all of that row's tracks. */
export type RowKind = 'bone' | 'part'
export type TrackName = 'rotation' | 'translate' | 'scale' | 'visible' | 'variant'
/** One diamond in the timeline: every key of that row at that frame. */
export interface KeyRef { kind: RowKind; id: Id; frame: number }

/** The row's key lists with their names, typed loosely: callers only read frames and move values across. */
function rowTracks(anim: Animation, kind: RowKind, id: Id): [TrackName, Key<unknown>[]][] {
  if (kind === 'bone') {
    const t = anim.boneTracks[id]
    return t ? [['rotation', t.rotation], ['translate', t.translate], ['scale', t.scale]] : []
  }
  const t = anim.partTracks[id]
  return t ? [['visible', t.visible], ['variant', t.variant]] : []
}

/** Frames of a row that carry at least one key. */
export function rowKeyFrames(anim: Animation, kind: RowKind, id: Id): Set<number> {
  const out = new Set<number>()
  for (const [, keys] of rowTracks(anim, kind, id)) for (const k of keys) out.add(k.frame)
  return out
}

/** Move every key of a row from one frame to another. */
export function moveRowKeys(anim: Animation, kind: RowKind, id: Id, from: number, to: number): void {
  for (const [, keys] of rowTracks(anim, kind, id)) moveKey(keys, from, to)
}

/** Delete every key of a row at a frame. Returns true when something went. */
export function deleteRowKeys(anim: Animation, kind: RowKind, id: Id, frame: number): boolean {
  let hit = false
  for (const [, keys] of rowTracks(anim, kind, id)) if (removeKey(keys, frame)) hit = true
  return hit
}

// ── copy / paste ─────────────────────────────────────────────────────────────

interface CopiedKey { track: TrackName; frame: number; value: unknown; interp: Interp }
interface CopiedRow { kind: RowKind; id: Id; keys: CopiedKey[] }

/** Keys lifted out of an animation, ready to be written back at another frame. */
export interface KeyClipboard {
  rows: CopiedRow[]
  /** Earliest copied frame; paste keeps every key's distance from it. */
  baseFrame: number
  /** How many individual track keys were taken (not diamonds). */
  count: number
  /** How many timeline diamonds were taken. */
  diamonds: number
}

/** Values are flat (Vec3, boolean, id), so a shallow copy detaches them from the document. */
const cloneValue = (v: unknown): unknown => (v !== null && typeof v === 'object' ? { ...(v as Record<string, unknown>) } : v)

/** Copy every key at the given row/frame pairs. Null when none of them exist. */
export function copyKeys(anim: Animation, refs: readonly KeyRef[]): KeyClipboard | null {
  const byRow = new Map<string, CopiedRow>()
  const seen = new Set<string>()
  let baseFrame = Infinity
  let count = 0
  let diamonds = 0
  for (const ref of refs) {
    const rowKey = `${ref.kind}:${ref.id}`
    if (seen.has(`${rowKey}:${ref.frame}`)) continue
    seen.add(`${rowKey}:${ref.frame}`)
    let taken = 0
    for (const [track, keys] of rowTracks(anim, ref.kind, ref.id)) {
      const k = keys.find(x => x.frame === ref.frame)
      if (!k) continue
      let row = byRow.get(rowKey)
      if (!row) { row = { kind: ref.kind, id: ref.id, keys: [] }; byRow.set(rowKey, row) }
      row.keys.push({ track, frame: ref.frame, value: cloneValue(k.value), interp: k.interp })
      taken++
    }
    if (taken > 0) { count += taken; diamonds++; baseFrame = Math.min(baseFrame, ref.frame) }
  }
  if (count === 0) return null
  return { rows: [...byRow.values()], baseFrame, count, diamonds }
}

/**
 * Write the clipboard back with `atFrame` standing in for the earliest copied
 * frame, so the spacing between copied keys is kept. Keys landing outside the
 * animation are dropped, as are rows `rowExists` rejects (a bone or part
 * deleted since the copy). Returns how many keys were written.
 */
export function pasteKeys(anim: Animation, clip: KeyClipboard, atFrame: number, rowExists: (kind: RowKind, id: Id) => boolean = () => true): number {
  let written = 0
  for (const row of clip.rows) {
    if (!rowExists(row.kind, row.id)) continue
    const landing = row.keys
      .map(k => ({ k, frame: atFrame + (k.frame - clip.baseFrame) }))
      .filter(x => x.frame >= 0 && x.frame < anim.frameCount)
    if (landing.length === 0) continue
    const tracks = row.kind === 'bone' ? ensureBoneTrack(anim, row.id) : ensurePartTrack(anim, row.id)
    for (const { k, frame } of landing) {
      const keys = (tracks as unknown as Record<string, Key<unknown>[] | undefined>)[k.track]
      if (!keys) continue
      // Replace rather than overwrite, so the copied interpolation lands too.
      removeKey(keys, frame)
      setKey(keys, frame, cloneValue(k.value), k.interp)
      written++
    }
  }
  return written
}

/** Where each copied diamond lands when pasted at `atFrame`, clamped to the animation. */
export function pastedRefs(clip: KeyClipboard, atFrame: number, frameCount: number): KeyRef[] {
  const out: KeyRef[] = []
  const seen = new Set<string>()
  for (const row of clip.rows) {
    for (const k of row.keys) {
      const frame = atFrame + (k.frame - clip.baseFrame)
      if (frame < 0 || frame >= frameCount) continue
      const id = `${row.kind}:${row.id}:${frame}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ kind: row.kind, id: row.id, frame })
    }
  }
  return out
}
