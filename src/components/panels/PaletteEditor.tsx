import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { exportPaletteFile, importPaletteFile } from '../../core/io/paletteActions'
import { askConfirm, askText, notice } from '../../core/ui/dialogs'
import {
  activePalette, addColor, collectImageColors, hexToRgba, insertColor, moveColor, PRESET_PALETTES, recolorProject, removeColor, rgbaToHex,
  sameColor, sortColors, uniquePaletteName, type PalettePreset,
} from '../../domain/palette'
import { addPalette, duplicatePalette, removePalette, renamePalette, setActivePalette } from '../../domain/project'
import type { Id, Project, RGBA } from '../../domain/types'
import { editorStore, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

interface Props { onClose: () => void }

interface ColorEdit { palId: Id; index: number; from: RGBA; to: RGBA; recolor: boolean }

function applyEdit(d: Project, e: ColorEdit): void {
  const pal = d.palettes[e.palId]
  if (!pal || !pal.colors[e.index]) return
  pal.colors[e.index] = [e.to[0], e.to[1], e.to[2], e.to[3]]
  if (e.recolor) recolorProject(d, e.from, e.to)
}

/**
 * The palette editor: switch, create, rename, delete, import and export the
 * project's palettes; add, remove, reorder and recolour swatches. Changing a
 * swatch can recolour every pixel painted with it, live while dragging, as one
 * undo step.
 */
export default function PaletteEditor({ onClose }: Props) {
  const doc = useEditor(s => s.doc)
  const primary = useEditor(s => s.ui.primary)
  const commit = useEditor(s => s.commit)
  const setUi = useEditor(s => s.setUi)
  const pal = activePalette(doc)
  const [sel, setSel] = useState(0)
  const [recolor, setRecolor] = useState(true)
  const [hexText, setHexText] = useState('')
  const edit = useRef<ColorEdit | null>(null)
  const colorRef = useRef<HTMLInputElement>(null)

  const index = Math.min(sel, Math.max(0, pal.colors.length - 1))
  const current: RGBA | null = pal.colors[index] ?? null
  const currentHex = current ? rgbaToHex(current) : ''

  useEffect(() => { setHexText(currentHex) }, [currentHex, pal.id, index])

  // ── live colour editing (preview while dragging, one commit at the end) ──
  const setDraft = (to: RGBA) => {
    if (!current) return
    const s = editorStore.getState()
    if (!edit.current) {
      edit.current = { palId: pal.id, index, from: current, to, recolor }
      s.beginPreview()
    }
    edit.current.to = to
    const e = edit.current
    s.preview(d => applyEdit(d, e))
  }
  const finishDraft = () => {
    const e = edit.current
    if (!e) return
    edit.current = null
    const s = editorStore.getState()
    if (sameColor(e.from, e.to)) { s.endPreview(); return }
    s.endPreview('Edit colour', d => applyEdit(d, e))
    // The brush follows the swatch it was picked from.
    s.setUi(ui => ({ primary: sameColor(ui.primary, e.from) ? e.to : ui.primary, secondary: sameColor(ui.secondary, e.from) ? e.to : ui.secondary }))
  }
  const finishRef = useRef(finishDraft)
  finishRef.current = finishDraft
  useEffect(() => () => finishRef.current(), [])

  // The system picker reports its final value with a native `change` event.
  useEffect(() => {
    const el = colorRef.current
    if (!el) return
    const done = () => finishRef.current()
    el.addEventListener('change', done)
    return () => el.removeEventListener('change', done)
  }, [current !== null])

  const close = () => { finishDraft(); onClose() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const select = (i: number) => {
    finishDraft()
    setSel(i)
    const c = pal.colors[i]
    if (c) setUi({ primary: c })
  }

  const commitHex = () => {
    const c = hexToRgba(hexText)
    if (c && current && !sameColor(c, current)) { setDraft(c); finishDraft() }
    else setHexText(currentHex)
  }

  const channel = (label: string, ch: 0 | 1 | 2) => (
    <label className="slider">
      <span>{label}</span>
      <input
        type="range" min={0} max={255} value={current?.[ch] ?? 0} disabled={!current} aria-label={`${label} channel`}
        onChange={e => { if (!current) return; const c = [current[0], current[1], current[2], 255] as [number, number, number, number]; c[ch] = Number(e.target.value); setDraft(c) }}
        onPointerUp={finishDraft}
        onBlur={finishDraft}
        onKeyUp={e => { if (/^(Arrow|Home|End|Page)/.test(e.key)) finishDraft() }}
      />
      <output>{current?.[ch] ?? ''}</output>
    </label>
  )

  // ── palette list ──
  const switchTo = (id: Id) => { finishDraft(); commit('Switch palette', d => { setActivePalette(d, id) }); setSel(0) }
  const newBlank = async () => {
    finishDraft()
    const name = await askText('New palette', { defaultValue: uniquePaletteName(doc, 'Palette'), label: 'Name', okLabel: 'Create' })
    if (!name) return
    commit('New palette', d => { const p = addPalette(d, name, [[0, 0, 0, 255], [255, 255, 255, 255]]); d.activePaletteId = p.id })
    setSel(0)
  }
  const newFromPreset = (preset: PalettePreset) => {
    finishDraft()
    commit('New palette', d => { const p = addPalette(d, preset.name, preset.colors); d.activePaletteId = p.id })
    setSel(0)
  }
  const duplicate = () => { finishDraft(); commit('Duplicate palette', d => { const p = duplicatePalette(d, pal.id); if (p) d.activePaletteId = p.id }) }
  const rename = async () => {
    finishDraft()
    const name = await askText('Rename palette', { defaultValue: pal.name, label: 'Name', okLabel: 'Rename' })
    if (name) commit('Rename palette', d => renamePalette(d, pal.id, name))
  }
  const remove = async () => {
    finishDraft()
    if (doc.paletteOrder.length <= 1) return
    const ok = await askConfirm(`Delete "${pal.name}"?`, { message: 'Pixels keep their colours; only this list of swatches goes.', okLabel: 'Delete', danger: true })
    if (ok) { commit('Delete palette', d => { removePalette(d, pal.id) }); setSel(0) }
  }
  const doImport = async () => {
    finishDraft()
    try {
      const r = await importPaletteFile()
      if (!r) return
      commit('Import palette', d => { const p = addPalette(d, r.name, r.colors); d.activePaletteId = p.id })
      setSel(0)
    } catch (e) {
      await notice('Import failed', e instanceof Error ? e.message : String(e))
    }
  }
  const doExport = async (format: 'hex' | 'gpl') => {
    finishDraft()
    try { await exportPaletteFile(pal, format) } catch (e) { await notice('Export failed', e instanceof Error ? e.message : String(e)) }
  }

  // ── swatches ──
  const addSwatch = () => {
    finishDraft()
    const c = current ?? primary
    const at = current ? index + 1 : 0
    commit('Add colour', d => { const p = d.palettes[pal.id]; if (p) insertColor(p.colors, at, c) })
    setSel(at)
  }
  const removeSwatch = () => {
    if (!current) return
    finishDraft()
    commit('Remove colour', d => { const p = d.palettes[pal.id]; if (p) removeColor(p.colors, index) })
    setSel(index)
  }
  const move = (dir: -1 | 1) => {
    if (!current) return
    const to = index + dir
    if (to < 0 || to >= pal.colors.length) return
    finishDraft()
    commit('Move colour', d => { const p = d.palettes[pal.id]; if (p) moveColor(p.colors, index, to) })
    setSel(to)
  }
  const sort = () => { finishDraft(); commit('Sort palette', d => { const p = d.palettes[pal.id]; if (p) sortColors(p.colors) }) }
  const fromArtwork = async () => {
    finishDraft()
    const used = collectImageColors(doc)
    const missing = used.filter(c => !pal.colors.some(x => sameColor(x, c)))
    if (missing.length === 0) { await notice('Nothing to add', used.length ? 'Every colour used in the artwork is already in this palette.' : 'No pixels have been drawn yet.'); return }
    commit('Add colours from artwork', d => { const p = d.palettes[pal.id]; if (p) for (const c of missing) addColor(p.colors, c) })
  }

  return createPortal(
    <div className="modal-backdrop" onClick={close}>
      <div className="modal modal--wide paled" role="dialog" aria-label="Palettes" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="paled__head">
          <h2>Palettes</h2>
          <button className="icon-btn" title="Close" onClick={close}><Icon name="close" /></button>
        </div>

        <div className="paled__row">
          <select className="select paled__select" value={pal.id} onChange={e => switchTo(e.target.value)} title="Active palette" aria-label="Active palette">
            {doc.paletteOrder.map(id => <option key={id} value={id}>{doc.palettes[id].name} · {doc.palettes[id].colors.length}</option>)}
          </select>
          <button className="text-btn" onClick={newBlank}><Icon name="plus" size={14} />New</button>
          <button className="text-btn" onClick={duplicate}><Icon name="copy" size={14} />Duplicate</button>
          <button className="text-btn" onClick={rename}>Rename</button>
          <button className="text-btn" onClick={remove} disabled={doc.paletteOrder.length <= 1} title={doc.paletteOrder.length <= 1 ? 'A project keeps at least one palette' : 'Delete this palette'}><Icon name="trash" size={14} />Delete</button>
        </div>

        <section>
          <h4>Colours · {pal.colors.length}</h4>
          <div className="paled__grid">
            {pal.colors.map((c, i) => (
              <button key={i} className={`swatch ${i === index ? 'is-selected' : ''}`} style={{ background: rgbaToHex(c) }} title={rgbaToHex(c)} aria-label={`Colour ${i + 1} ${rgbaToHex(c)}`} onClick={() => select(i)} />
            ))}
            <button className="swatch swatch--add" title="Add a colour after the selected one" onClick={addSwatch}><Icon name="plus" size={14} /></button>
          </div>
          <div className="paled__tools">
            <button className="icon-btn" title="Move left" disabled={!current || index === 0} onClick={() => move(-1)}><Icon name="left" size={16} /></button>
            <button className="icon-btn" title="Move right" disabled={!current || index >= pal.colors.length - 1} onClick={() => move(1)}><Icon name="right" size={16} /></button>
            <button className="icon-btn" title="Remove colour (pixels keep it)" disabled={!current} onClick={removeSwatch}><Icon name="trash" size={16} /></button>
            <button className="text-btn" title="Order dark to light" disabled={pal.colors.length < 2} onClick={sort}><Icon name="sort" size={14} />Sort</button>
            <button className="text-btn" title="Append every colour painted in the project that is not in this palette yet" onClick={fromArtwork}>Add colours from artwork</button>
          </div>
        </section>

        <section>
          <h4>Selected colour</h4>
          {current ? (
            <div className="paled__editor">
              <button className="paled__big" style={{ background: currentHex }} title="Open the system colour picker" onClick={() => colorRef.current?.click()} />
              <input ref={colorRef} type="color" className="palette__input" value={currentHex} aria-label="Colour picker" onChange={e => { const c = hexToRgba(e.target.value); if (c) setDraft(c) }} />
              <div className="paled__fields">
                <div className="paled__row">
                  <input className="paled__hex" value={hexText} spellCheck={false} aria-label="Hex value" onChange={e => setHexText(e.target.value)} onBlur={commitHex} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                  <button className="text-btn" onClick={() => setUi({ primary: current })}>Use as brush colour</button>
                </div>
                {channel('R', 0)}
                {channel('G', 1)}
                {channel('B', 2)}
              </div>
            </div>
          ) : (
            <small>This palette is empty. Add a colour to start, or pick a preset below.</small>
          )}
          <label className="field field--row">
            <input type="checkbox" checked={recolor} onChange={e => setRecolor(e.target.checked)} />
            <span>Recolour pixels in every image when a swatch changes</span>
          </label>
        </section>

        <section>
          <h4>New palette from a preset</h4>
          <div className="chips">
            {PRESET_PALETTES.map(p => (
              <button key={p.name} className="chip paled__preset" title={`New palette with the ${p.colors.length} colours of ${p.name}`} onClick={() => newFromPreset(p)}>
                <span className="pal-strip">{p.colors.map((c, i) => <i key={i} style={{ background: rgbaToHex(c) }} />)}</span>
                {p.name}
              </button>
            ))}
          </div>
          <div className="paled__row">
            <button className="text-btn" onClick={doImport}><Icon name="import" size={14} />Import .hex / .gpl / .pal…</button>
            <span className="spacer" />
            <button className="text-btn" title="Export this palette as a Lospec / Aseprite .hex list" onClick={() => doExport('hex')}><Icon name="export" size={14} />Export .hex</button>
            <button className="text-btn" title="Export this palette as a GIMP / Aseprite / Krita .gpl file" onClick={() => doExport('gpl')}><Icon name="export" size={14} />Export .gpl</button>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  )
}
