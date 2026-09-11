import type { Id, Project, ViewIndex } from '../../domain/types'
import { composeFrame } from './rasterizer'

interface Entry { revision: number; data: Uint8ClampedArray }

/**
 * Memoises composed frames per (animation, frame, view). Any document change
 * bumps `revision`, which invalidates everything lazily: recomposing a frame
 * is microseconds, so a fine-grained dependency map is not worth its bugs.
 */
export class FrameCache {
  private entries = new Map<string, Entry>()

  constructor(
    private readonly getProject: () => Project,
    private readonly getRevision: () => number,
  ) {}

  static key(animId: Id | null, frame: number, view: ViewIndex): string {
    return `${animId ?? '_'}:${frame}:${view}`
  }

  get(animId: Id | null, frame: number, view: ViewIndex): Uint8ClampedArray {
    const rev = this.getRevision()
    const key = FrameCache.key(animId, frame, view)
    const hit = this.entries.get(key)
    if (hit && hit.revision === rev) return hit.data
    const data = composeFrame(this.getProject(), animId, frame, view, hit ? { out: hit.data } : {})
    this.entries.set(key, { revision: rev, data })
    return data
  }

  /** Drop everything (e.g. when a different project is loaded). */
  clear(): void {
    this.entries.clear()
  }

  /** Remove entries older than the current revision. Call occasionally to bound memory. */
  prune(): void {
    const rev = this.getRevision()
    for (const [k, e] of this.entries) if (e.revision !== rev) this.entries.delete(k)
  }

  get size(): number {
    return this.entries.size
  }
}
