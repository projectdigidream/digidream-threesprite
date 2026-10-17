import { useEffect, useRef, useState } from 'react'
import { BACKGROUNDS, canvasPrefs, swatchStyle, useCanvasPrefs } from '../../store/canvasPrefs'
import type { Mode } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

/**
 * The canvas's own corner: what the art is drawn over (dark art vanishes into
 * dark checks), and in Animate whether the bones are drawn over it.
 */
export default function CanvasCorner({ mode }: { mode: Mode }) {
  const background = useCanvasPrefs(p => p.background)
  const bones = useCanvasPrefs(p => p.bones)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])

  return (
    <div className="pixel-canvas__corner" ref={ref}>
      {mode === 'animate' && (
        <button
          className={`icon-btn ${bones ? 'is-active' : ''}`}
          title={bones ? 'Hide the bones (they hide while playing anyway)' : 'Show the bones, to pose by dragging them'}
          aria-label="Show bones" aria-pressed={bones}
          onClick={() => canvasPrefs.getState().setBones(!bones)}
        ><Icon name="bone" size={16} /></button>
      )}
      <button className="icon-btn" title="Canvas background" aria-label="Canvas background" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="pixel-canvas__swatch" style={swatchStyle(background)} />
      </button>
      {open && (
        <div className="pixel-canvas__backgrounds" role="menu">
          {BACKGROUNDS.map(b => (
            <button
              key={b.id} role="menuitemradio" aria-checked={b.id === background} title={b.label} aria-label={b.label}
              className={`icon-btn ${b.id === background ? 'is-active' : ''}`}
              onClick={() => { canvasPrefs.getState().setBackground(b.id); setOpen(false) }}
            ><span className="pixel-canvas__swatch" style={swatchStyle(b.id)} /></button>
          ))}
        </div>
      )}
    </div>
  )
}
