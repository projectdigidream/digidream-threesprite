import { useEffect, useRef, useState } from 'react'
import { PreviewScene } from '../../core/preview/scene'
import { viewLabel } from '../../domain/views'
import { frameCache } from '../../store/caches'
import { editorStore, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

/**
 * The 3D billboard preview with its transport strip. Orbit with the pointer
 * (one finger rotates, two fingers zoom/pan); the view shown swaps exactly
 * the way a game picks rotations from the camera bearing.
 */
export default function Preview3D() {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<PreviewScene | null>(null)
  const [shown, setShown] = useState<number>(1)
  const [error, setError] = useState<string | null>(null)

  const N = useEditor(s => s.doc.views.count)
  const spread = useEditor(s => s.ui.spread)
  const facing = useEditor(s => s.ui.previewFacing)
  const playing = useEditor(s => s.ui.playing)
  const animId = useEditor(s => s.ui.animId)
  const animations = useEditor(s => s.doc.animations)
  const animationOrder = useEditor(s => s.doc.animationOrder)
  const frame = useEditor(s => s.ui.frame)
  const showArrows = useEditor(s => s.ui.showArrows)
  const setUi = useEditor(s => s.setUi)

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    let scene: PreviewScene
    try {
      scene = new PreviewScene(canvas, {
        frame: (a, f, v) => frameCache.get(a, f, v),
        canvasSize: () => editorStore.getState().doc.canvas.size,
        revision: () => editorStore.getState().revision,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    sceneRef.current = scene
    scene.onView = v => setShown(v)
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      scene.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)))
    })
    ro.observe(host)
    let raf = 0
    const loop = () => {
      const s = editorStore.getState()
      scene.tick({
        N: s.doc.views.count,
        animId: s.ui.animId,
        frame: s.ui.frame,
        worldHeight: s.doc.export.worldHeight,
        spread: s.ui.spread,
        facingTurns: s.ui.previewFacing,
        showArrows: s.ui.showArrows,
      })
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  const anim = animId ? animations[animId] : null

  return (
    <div className="preview3d">
      <div className="preview3d__host" ref={hostRef}>
        <canvas ref={canvasRef} className="preview3d__canvas" />
        {error && <div className="pixel-canvas__banner">WebGL unavailable: {error}</div>}
        <div className="preview3d__readout">Camera sees view {shown} · {viewLabel(N, shown)}</div>
      </div>
      <div className="preview3d__bar">
        <select className="select" value={animId ?? ''} onChange={e => setUi({ animId: e.target.value, frame: 0 })} title="Animation">
          {animationOrder.map(id => <option key={id} value={id}>{animations[id].name}</option>)}
        </select>
        <button className="icon-btn" title="Play / pause (Space)" disabled={!anim} onClick={() => setUi({ playing: !playing })}><Icon name={playing ? 'pause' : 'play'} /></button>
        <span className="transport__frame">{anim ? `${frame + 1}/${anim.frameCount}` : '–'}</span>
        {anim && anim.frameCount > 1 && (
          <input className="preview3d__scrub" type="range" min={0} max={anim.frameCount - 1} step={1} value={frame} title="Scrub frames (pauses playback)" onChange={e => setUi({ frame: Number(e.target.value), playing: false })} />
        )}
        <label className="preview3d__facing" title="Which way the character faces (turns anticlockwise seen from above)">
          <span>Facing {Math.round(facing * 360)}°</span>
          <input type="range" min={0} max={359} step={1} value={Math.round(facing * 360) % 360} disabled={spread} onChange={e => setUi({ previewFacing: Number(e.target.value) / 360 })} />
        </label>
        <label className="field--row" title="Show one instance per view, each facing a different way, so every view is visible at once">
          <input type="checkbox" checked={spread} onChange={e => setUi({ spread: e.target.checked })} />
          <span>Spread {N}</span>
        </label>
        <button className={`icon-btn ${showArrows ? 'is-active' : ''}`} title="Facing arrows and labels" onClick={() => setUi({ showArrows: !showArrows })}><Icon name="move" size={16} /></button>
        <button className="icon-btn" title="Reset camera" onClick={() => sceneRef.current?.resetCamera(editorStore.getState().doc.export.worldHeight, spread ? N * 1.5 * editorStore.getState().doc.export.worldHeight : 0)}><Icon name="fit" size={16} /></button>
      </div>
    </div>
  )
}
