import { useState } from 'react'
import { activePalette, addColor, hexToRgba, recolorProject, removeColor, rgbaToHex, sameColor } from '../../domain/palette'
import { setActivePalette } from '../../domain/project'
import type { RGBA } from '../../domain/types'
import { useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'
import PaletteEditor from './PaletteEditor'

export default function PalettePanel({ compact = false }: { compact?: boolean }) {
  const palettes = useEditor(s => s.doc.palettes)
  const order = useEditor(s => s.doc.paletteOrder)
  const activeId = useEditor(s => s.doc.activePaletteId)
  const colors = useEditor(s => activePalette(s.doc).colors)
  const primary = useEditor(s => s.ui.primary)
  const secondary = useEditor(s => s.ui.secondary)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)
  const [open, setOpen] = useState(false)

  const pick = (c: RGBA, e: React.MouseEvent) => {
    if (e.shiftKey) setUi({ secondary: c })
    else setUi({ primary: c })
  }

  const onInput = (hex: string) => {
    const c = hexToRgba(hex)
    if (c) setUi({ primary: c })
  }

  const inPalette = colors.some(c => sameColor(c, primary))

  /** Every pixel of the secondary colour becomes the primary colour; the palette merges the two swatches. */
  const replaceEverywhere = () => {
    const from = secondary
    const to = primary
    if (sameColor(from, to)) return
    commit('Replace colour', d => {
      recolorProject(d, from, to)
      const pal = activePalette(d)
      const i = pal.colors.findIndex(c => sameColor(c, from))
      if (i >= 0) {
        if (pal.colors.some(c => sameColor(c, to))) removeColor(pal.colors, i)
        else pal.colors[i] = [to[0], to[1], to[2], to[3]]
      }
    })
    setUi({ secondary: to })
  }

  const switchTo = (id: string) => commit('Switch palette', d => { setActivePalette(d, id) })

  const editButton = <button className="icon-btn" title="Palettes: switch, edit, import" onClick={() => setOpen(true)}><Icon name="palette" size={18} /></button>

  return (
    <div className={`palette ${compact ? 'palette--compact' : ''}`}>
      {!compact && (
        <div className="palette__head">
          <select className="select palette__select" value={activeId} onChange={e => switchTo(e.target.value)} title="Active palette" aria-label="Active palette">
            {order.map(id => <option key={id} value={id}>{palettes[id]?.name ?? id}</option>)}
          </select>
          {editButton}
        </div>
      )}
      <div className="palette__current">
        <button className="swatch swatch--big" style={{ background: rgbaToHex(primary) }} title="Primary colour (click to edit)" onClick={() => document.getElementById('primary-color-input')?.click()} />
        <button className="swatch swatch--small" style={{ background: rgbaToHex(secondary) }} title="Secondary colour (shift-click a swatch)" onClick={() => setUi({ primary: secondary, secondary: primary })} />
        <input id="primary-color-input" type="color" value={rgbaToHex(primary)} onChange={e => onInput(e.target.value)} className="palette__input" aria-label="Primary colour" />
        <button className="icon-btn" title="Swap colours (X)" onClick={() => setUi({ primary: secondary, secondary: primary })}><Icon name="swap" size={16} /></button>
        {!inPalette && <button className="icon-btn" title="Add to palette" onClick={() => commit('Add colour', d => { addColor(activePalette(d).colors, primary) })}><Icon name="plus" size={16} /></button>}
        {compact && editButton}
      </div>
      <div className="palette__grid">
        {colors.map((c, i) => (
          <button
            key={i}
            className={`swatch ${sameColor(c, primary) ? 'is-primary' : ''} ${sameColor(c, secondary) ? 'is-secondary' : ''}`}
            style={{ background: rgbaToHex(c) }}
            title={rgbaToHex(c)}
            onClick={e => pick(c, e)}
          />
        ))}
        {colors.length === 0 && <small className="palette__empty">Empty palette</small>}
      </div>
      {!compact && (
        <button className="text-btn" title="Replace every pixel of the secondary colour with the primary colour, in all images" onClick={replaceEverywhere}>Replace secondary → primary everywhere</button>
      )}
      {open && <PaletteEditor onClose={() => setOpen(false)} />}
    </div>
  )
}
