import { useState } from 'react'
import { createProject, normalizeSpriteName } from '../../domain/project'
import { MAX_CANVAS, MAX_SPRITE_NAME, MIN_CANVAS } from '../../domain/types'
import { clampViewCount, MAX_VIEWS, VIEW_PRESETS } from '../../domain/views'
import { askConfirm } from '../../core/ui/dialogs'
import { useEditor } from '../../store/editorStore'

const SIZES = [16, 24, 32, 48, 64, 96, 128, 256]

interface Props {
  onClose: () => void
  /** Starting name, e.g. taken from the file a host is creating. */
  defaultName?: string
}

export default function NewProjectDialog({ onClose, defaultName }: Props) {
  const loadProject = useEditor(s => s.loadProject)
  const dirty = useEditor(s => s.dirty)
  const [name, setName] = useState(defaultName ?? 'New sprite')
  const [spriteName, setSpriteName] = useState(defaultName ? normalizeSpriteName(defaultName) : 'SPRT')
  const [size, setSize] = useState(64)
  const [customSize, setCustomSize] = useState('')
  const [views, setViews] = useState(8)
  const [customViews, setCustomViews] = useState('')
  const [mirror, setMirror] = useState(true)

  const effSize = customSize ? Number(customSize) : size
  const effViews = customViews ? clampViewCount(Number(customViews)) : views

  const create = async () => {
    if (dirty && !(await askConfirm('Discard unsaved changes in the current project?', { okLabel: 'Discard', danger: true }))) return
    loadProject(createProject({ name, spriteName, canvasSize: effSize, viewCount: effViews, mirror }))
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} role="dialog" aria-label="New project">
        <h2>New sprite</h2>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Sprite id (the stem of every exported file)</span>
          <input value={spriteName} maxLength={MAX_SPRITE_NAME} onChange={e => setSpriteName(e.target.value)} onBlur={() => setSpriteName(normalizeSpriteName(spriteName))} />
          <small>Letters, digits, <code>_</code> and <code>-</code>. Doom-style export is the one format that wants exactly 4, in capitals.</small>
        </label>
        <div className="field">
          <span>Canvas size (square, {MIN_CANVAS}–{MAX_CANVAS} px). Every frame of every view is rendered on this canvas; feet go on the bottom row.</span>
          <div className="chips">
            {SIZES.map(s => <button key={s} className={`chip ${!customSize && size === s ? 'is-active' : ''}`} onClick={() => { setSize(s); setCustomSize('') }}>{s}</button>)}
            <input className="chip-input" placeholder="custom" inputMode="numeric" value={customSize} onChange={e => setCustomSize(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <div className="field">
          <span>Views (rotation angles around the character, 1–{MAX_VIEWS})</span>
          <div className="chips">
            {VIEW_PRESETS.map(v => <button key={v} className={`chip ${!customViews && views === v ? 'is-active' : ''}`} onClick={() => { setViews(v); setCustomViews('') }}>{v}</button>)}
            <input className="chip-input" placeholder="custom" inputMode="numeric" value={customViews} onChange={e => setCustomViews(e.target.value.replace(/\D/g, ''))} />
          </div>
          <small>View 1 faces the viewer; views go anticlockwise around the character seen from above. {effViews} views = one every {Math.round((360 / effViews) * 100) / 100}°.</small>
        </div>
        <label className="field field--row">
          <input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} />
          <span>Mirror symmetry: draw only {Math.floor(effViews / 2) + 1} of {effViews} views; the rest are flipped automatically.</span>
        </label>
        <div className="modal__actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  )
}
