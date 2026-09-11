import { frameAt } from '../domain/animation'
import { editorStore } from './editorStore'

/**
 * Drives `ui.frame` from the wall clock while `ui.playing`. One rAF loop for
 * the app; the canvas and the 3D preview just read `ui.frame`. Frame choice
 * goes through `frameAt`, the same function the exporters' GIF timing uses.
 */
export function startPlaybackLoop(): () => void {
  let raf = 0
  let startTime = 0
  let startFrame = 0
  let wasPlaying = false
  let lastAnim: string | null = null

  const tick = (now: number) => {
    const s = editorStore.getState()
    const anim = s.ui.animId ? s.doc.animations[s.ui.animId] : null
    if (s.ui.playing && anim) {
      if (!wasPlaying || lastAnim !== anim.id) {
        wasPlaying = true
        lastAnim = anim.id
        startTime = now
        startFrame = s.ui.frame >= anim.frameCount - 1 && !anim.loop ? 0 : s.ui.frame
      }
      const fps = anim.fps > 0 ? anim.fps : 0
      const seconds = (now - startTime) / 1000 + (fps > 0 ? startFrame / fps : 0)
      const f = frameAt(anim, seconds)
      if (f !== s.ui.frame) s.setUi({ frame: f })
      if (!anim.loop && fps > 0 && seconds * fps >= anim.frameCount) s.setUi({ playing: false })
      if (fps === 0) s.setUi({ playing: false })
    } else {
      wasPlaying = false
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}
