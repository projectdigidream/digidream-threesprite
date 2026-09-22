/** Turning elapsed time into a frame number. */

export interface Timing {
  /** Frames per second. 0 holds the first frame. */
  fps: number
  frameCount: number
  loop: boolean
}

/**
 * The frame showing `seconds` into an animation.
 *
 * A looping animation wraps; a one-shot holds its last frame. Negative time,
 * zero fps and a single frame all give frame 0, so a caller never has to guard.
 */
export function frameAt(timing: Timing, seconds: number): number {
  const n = Math.max(1, Math.floor(timing.frameCount))
  if (n <= 1 || !(timing.fps > 0) || !(seconds > 0)) return 0
  const f = Math.floor(seconds * timing.fps)
  return timing.loop ? f % n : Math.min(f, n - 1)
}

/** How long one pass of an animation lasts, in seconds. 0 when it never advances. */
export function durationSeconds(timing: Timing): number {
  const n = Math.max(1, Math.floor(timing.frameCount))
  return timing.fps > 0 ? n / timing.fps : 0
}

/** Whether a one-shot animation has reached its last frame by `seconds`. Looping ones never finish. */
export function isFinished(timing: Timing, seconds: number): boolean {
  if (timing.loop) return false
  const d = durationSeconds(timing)
  return d > 0 && seconds >= d
}

/**
 * A clock for one playing sprite, for engines that would rather advance by a
 * delta than track a start time. `time` is plain seconds; set it directly to
 * scrub, and `reset()` to start an animation over.
 */
export class Playhead {
  time = 0

  constructor(private timing: Timing) {}

  /** Swap in another animation's timing, keeping or restarting the clock. */
  retime(timing: Timing, restart = true): void {
    this.timing = timing
    if (restart) this.time = 0
  }

  advance(deltaSeconds: number): number {
    this.time += deltaSeconds
    return this.frame
  }

  reset(): void {
    this.time = 0
  }

  get frame(): number {
    return frameAt(this.timing, this.time)
  }

  get finished(): boolean {
    return isFinished(this.timing, this.time)
  }
}
