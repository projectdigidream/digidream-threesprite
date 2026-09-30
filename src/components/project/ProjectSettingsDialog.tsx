import { MAX_SPRITE_NAME } from '../../domain/types'
import { useState } from 'react'
import { clampDepthScale, MAX_DEPTH_SCALE, normalizeSpriteName, setViews } from '../../domain/project'
import { authoredViewCount, clampViewCount, MAX_VIEWS, VIEW_PRESETS } from '../../domain/views'
import { useEditor } from '../../store/editorStore'

export default function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const doc = useEditor(s => s.doc)
  const commit = useEditor(s => s.commit)
  const [name, setName] = useState(doc.name)
  const [spriteName, setSpriteName] = useState(doc.spriteName)
  const [views, setViewsN] = useState(doc.views.count)
  const [customViews, setCustomViews] = useState(VIEW_PRESETS.includes(doc.views.count as never) ? '' : String(doc.views.count))
  const [mirror, setMirror] = useState(doc.views.mirror)
  const [elevation, setElevation] = useState(String(doc.views.elevationDeg))
  const [depth, setDepth] = useState(String(doc.views.depthScale))
  const [worldHeight, setWorldHeight] = useState(String(doc.export.worldHeight))
  const [warnings, setWarnings] = useState<string[]>([])

  const effViews = customViews ? clampViewCount(Number(customViews)) : views
  const effElevation = Number.isFinite(Number(elevation)) ? Number(elevation) : doc.views.elevationDeg
  const effDepth = Number.isFinite(Number(depth)) ? clampDepthScale(Number(depth)) : doc.views.depthScale
  const gridChanged = effViews !== doc.views.count || mirror !== doc.views.mirror
  const viewsChanged = gridChanged || effElevation !== doc.views.elevationDeg || effDepth !== doc.views.depthScale

  const apply = () => {
    let w: string[] = []
    commit('Project settings', d => {
      d.name = name.trim() || d.name
      d.spriteName = normalizeSpriteName(spriteName)
      const h = Number(worldHeight)
      if (Number.isFinite(h) && h > 0) d.export.worldHeight = h
      if (viewsChanged) w = setViews(d, effViews, mirror, effElevation, effDepth)
    })
    if (w.length) setWarnings(w)
    else onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="Project settings">
        <h2>Project settings</h2>
        <label className="field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="field"><span>Sprite id (the stem of every exported file)</span><input value={spriteName} maxLength={MAX_SPRITE_NAME} onChange={e => setSpriteName(e.target.value)} /><small>Letters, digits, <code>_</code> and <code>-</code>. Doom-style export wants exactly 4, in capitals.</small></label>
        <div className="field">
          <span>Canvas: {doc.canvas.size}px (fixed after creation)</span>
        </div>
        <div className="field">
          <span>Views (1–{MAX_VIEWS})</span>
          <div className="chips">
            {VIEW_PRESETS.map(v => <button key={v} className={`chip ${!customViews && views === v ? 'is-active' : ''}`} onClick={() => { setViewsN(v); setCustomViews('') }}>{v}</button>)}
            <input className="chip-input" placeholder="custom" inputMode="numeric" value={customViews} onChange={e => setCustomViews(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <label className="field field--row">
          <input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />
          <span>Mirror symmetry (author {authoredViewCount(effViews, mirror)} of {effViews} views)</span>
        </label>
        <label className="field"><span>Camera elevation (degrees above the horizon, for bones and solids in every view; 0 = level)</span><input inputMode="decimal" value={elevation} onChange={e => setElevation(e.target.value)} /></label>
        <label className="field"><span>Depth scaling (0 = off, up to {MAX_DEPTH_SCALE})</span><input inputMode="decimal" value={depth} onChange={e => setDepth(e.target.value)} /><small>How strongly a bone travelling towards the camera grows what hangs off it, and away shrinks it — pixel parts, each bone of a skinned part, and solids. Sprites move little in depth, so 1 is nearly invisible and 5–20 is where it reads. The rest pose never changes size.</small></label>
        {gridChanged && <p className="warning">Changing the view count drops images drawn for views that no longer exist. This is undoable.</p>}
        <label className="field"><span>World height (units, written into export manifests)</span><input inputMode="decimal" value={worldHeight} onChange={e => setWorldHeight(e.target.value)} /></label>
        {warnings.length > 0 && (
          <div className="warning">
            <b>Applied with warnings:</b>
            <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
        <div className="modal__actions">
          <button onClick={onClose}>{warnings.length ? 'Close' : 'Cancel'}</button>
          {!warnings.length && <button className="primary" onClick={apply}>Apply</button>}
        </div>
      </div>
    </div>
  )
}
