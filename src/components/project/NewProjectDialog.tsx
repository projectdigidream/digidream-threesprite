import { useState } from 'react'
import { createProject, normalizeSpriteName } from '../../domain/project'
import { MAX_CANVAS, MAX_SPRITE_NAME, MIN_CANVAS } from '../../domain/types'
import { clampViewCount, MAX_VIEWS, VIEW_PRESETS } from '../../domain/views'
import { leaveCurrent } from '../../core/io/projectActions'
import { useEditor } from '../../store/editorStore'

const SIZES = [16, 24, 32, 48, 64, 96, 128, 256]

/** How the sprite is seen: one picture first, the way a newcomer starts; views can be added later in Project settings. */
type Shape = 'one' | 'around' | 'custom'
const SHAPES: { id: Shape; title: string; text: string }[] = [
  { id: 'one', title: 'One picture', text: 'Drawn once, the same from every side.' },
  { id: 'around', title: 'All the way round', text: '8 views: draw 5 sides, 3 are mirrored.' },
  { id: 'custom', title: 'Choose the views…', text: '1 to 64 views, mirrored or not.' },
]

interface Props {
  onClose: () => void
  /** Starting name, e.g. taken from the file a host is creating. */
  defaultName?: string
}

export default function NewProjectDialog({ onClose, defaultName }: Props) {
  const loadProject = useEditor(s => s.loadProject)
  const [name, setName] = useState(defaultName ?? 'New sprite')
  const [spriteName, setSpriteName] = useState(defaultName ? normalizeSpriteName(defaultName) : 'SPRT')
  // The id follows the name until it is typed by hand: sprites left at SPRT
  // all export under one stem, and replace each other wherever they land.
  const [idTyped, setIdTyped] = useState(false)
  const rename = (v: string) => { setName(v); if (!idTyped) setSpriteName(normalizeSpriteName(v)) }
  const [size, setSize] = useState(64)
  const [customSize, setCustomSize] = useState('')
  const [shape, setShape] = useState<Shape>('one')
  const [views, setViews] = useState(8)
  const [customViews, setCustomViews] = useState('')
  const [mirror, setMirror] = useState(true)

  const effSize = customSize ? Number(customSize) : size
  const effViews = shape === 'one' ? 1 : shape === 'around' ? 8 : customViews ? clampViewCount(Number(customViews)) : views
  const effMirror = shape === 'around' || (shape === 'custom' && mirror)

  const create = async () => {
    if (!(await leaveCurrent())) return
    loadProject(createProject({ name, spriteName, canvasSize: effSize, viewCount: effViews, mirror: effMirror }))
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--form" onClick={e => e.stopPropagation()} role="dialog" aria-label="New project">
        <h2>New sprite</h2>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={e => rename(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Sprite id (the stem of every exported file)</span>
          <input value={spriteName} maxLength={MAX_SPRITE_NAME} onChange={e => { setIdTyped(true); setSpriteName(e.target.value) }} onBlur={() => setSpriteName(normalizeSpriteName(spriteName))} />
          <small>Letters, digits, <code>_</code> and <code>-</code>. Doom-style export is the one format that wants exactly 4, in capitals.</small>
        </label>
        <div className="field">
          <span>Size in pixels (square, {MIN_CANVAS}–{MAX_CANVAS}). Every frame is drawn on a canvas this size, feet on the bottom row.</span>
          <div className="chips">
            {SIZES.map(s => <button key={s} className={`chip ${!customSize && size === s ? 'is-active' : ''}`} onClick={() => { setSize(s); setCustomSize('') }}>{s}</button>)}
            <input className="chip-input" placeholder="custom" inputMode="numeric" value={customSize} onChange={e => setCustomSize(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <div className="field">
          <span>How is it seen?</span>
          <div className="choice-cards" role="radiogroup" aria-label="How is it seen">
            {SHAPES.map(c => (
              <button key={c.id} role="radio" aria-checked={shape === c.id} className={`choice-card ${shape === c.id ? 'is-active' : ''}`} onClick={() => setShape(c.id)}>
                <b>{c.title}</b>
                <span>{c.text}</span>
              </button>
            ))}
          </div>
          <small>You can change this later, in Project settings.</small>
        </div>
        {shape === 'custom' && (
          <>
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
          </>
        )}
        <div className="modal__actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  )
}
