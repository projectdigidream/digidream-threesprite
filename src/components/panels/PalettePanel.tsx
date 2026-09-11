import { useState } from 'react'
import { addColor, hexToRgba, removeColor, replaceColor, rgbaToHex } from '../../domain/palette'
import type { RGBA } from '../../domain/types'
import { useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

function same(a: RGBA, b: RGBA) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] }

export default function PalettePanel({ compact = false }: { compact?: boolean }) {
  const colors = useEditor(s => s.doc.palette.colors)
  const primary = useEditor(s => s.ui.primary)
  const secondary = useEditor(s => s.ui.secondary)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)
  const [editing, setEditing] = useState(false)

  const pick = (c: RGBA, e: React.MouseEvent) => {
    if (editing) {
      const i = colors.findIndex(x => same(x, c))
      if (i >= 0) commit('Remove colour', d => removeColor(d.palette.colors, i))
      return
    }
    if (e.shiftKey) setUi({ secondary: c })
    else setUi({ primary: c })
  }

  const onInput = (hex: string) => {
    const c = hexToRgba(hex)
    if (c) setUi({ primary: c })
  }

  const inPalette = colors.some(c => same(c, primary))

  const replaceEverywhere = () => {
    const i = colors.findIndex(c => same(c, secondary))
    if (i < 0) return
    const from = colors[i]
    const to = primary
    commit('Replace colour', d => {
      for (const part of Object.values(d.parts)) for (const v of Object.values(part.variants)) for (const img of Object.values(v.images)) replaceColor(img, from, to)
      d.palette.colors[i] = [to[0], to[1], to[2], to[3]]
    })
  }

  return (
    <div className={`palette ${compact ? 'palette--compact' : ''}`}>
      <div className="palette__current">
        <button className="swatch swatch--big" style={{ background: rgbaToHex(primary) }} title="Primary colour (click to edit)" onClick={() => document.getElementById('primary-color-input')?.click()} />
        <button className="swatch swatch--small" style={{ background: rgbaToHex(secondary) }} title="Secondary colour (shift-click a swatch)" onClick={() => setUi({ primary: secondary, secondary: primary })} />
        <input id="primary-color-input" type="color" value={rgbaToHex(primary)} onChange={e => onInput(e.target.value)} className="palette__input" aria-label="Primary colour" />
        <button className="icon-btn" title="Swap colours (X)" onClick={() => setUi({ primary: secondary, secondary: primary })}><Icon name="swap" size={16} /></button>
        {!inPalette && <button className="icon-btn" title="Add to palette" onClick={() => commit('Add colour', d => { addColor(d.palette.colors, primary) })}><Icon name="plus" size={16} /></button>}
        <button className={`icon-btn ${editing ? 'is-active' : ''}`} title="Edit palette (click a swatch to remove it)" onClick={() => setEditing(v => !v)}><Icon name="trash" size={16} /></button>
      </div>
      <div className="palette__grid">
        {colors.map((c, i) => (
          <button
            key={i}
            className={`swatch ${same(c, primary) ? 'is-primary' : ''} ${same(c, secondary) ? 'is-secondary' : ''} ${editing ? 'is-editing' : ''}`}
            style={{ background: rgbaToHex(c) }}
            title={rgbaToHex(c)}
            onClick={e => pick(c, e)}
          />
        ))}
      </div>
      {!compact && (
        <button className="text-btn" title="Replace every pixel of the secondary colour with the primary colour, in all images" onClick={replaceEverywhere}>Replace secondary → primary everywhere</button>
      )}
    </div>
  )
}
