import { useEffect, useRef, useState } from 'react'
import { copyKeys, deleteRowKeys, moveRowKeys, pasteKeys, pastedRefs, rowKeyFrames, type KeyClipboard, type KeyRef } from '../../domain/animation'
import { addAnimation, boneOrder, removeAnimation, setFrameCount } from '../../domain/project'
import type { Animation, Id } from '../../domain/types'
import { askConfirm, askText } from '../../core/ui/dialogs'
import { isTypingTarget } from '../../hooks/useKeyboardShortcuts'
import { editorStore, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

/** Ask for a name and create the animation; selects it. Shared by the transport and the empty state. */
async function promptNewAnimation(): Promise<void> {
  const s = editorStore.getState()
  const name = await askText('New animation', { label: 'Name', defaultValue: `anim ${s.doc.animationOrder.length + 1}`, okLabel: 'Add' })
  if (!name) return
  let id: Id | null = null
  editorStore.getState().commit('Add animation', d => { id = addAnimation(d, { name }).id })
  if (id) editorStore.getState().setUi({ animId: id, frame: 0 })
}

const CELL = 20

type RowKind = 'bone' | 'part'
interface Row { kind: RowKind; id: Id; name: string; depth: number }

const refId = (kind: RowKind, id: Id, frame: number) => `${kind}:${id}:${frame}`

export default function Timeline() {
  const doc = useEditor(s => s.doc)
  const ui = useEditor(s => s.ui)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)
  const anim = ui.animId ? doc.animations[ui.animId] : null
  const gridRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ row: Row; from: number; to: number; pointerId: number; el: HTMLElement } | null>(null)
  const longPressRef = useRef(0)
  /** Selected diamonds, for copying. */
  const [sel, setSel] = useState<KeyRef[]>([])
  const [clip, setClip] = useState<KeyClipboard | null>(null)
  /** Touch has no modifier keys, so picking several keys gets its own toggle. */
  const [multi, setMulti] = useState(false)
  // Keys can vanish under the selection (undo, delete), so only count the ones
  // still on the timeline; otherwise the Copy button promises more than it takes.
  const liveSel = anim ? sel.filter(s => rowKeyFrames(anim, s.kind, s.id).has(s.frame)) : []
  const selSet = new Set(liveSel.map(s => refId(s.kind, s.id, s.frame)))

  // A selection belongs to one animation.
  useEffect(() => { setSel([]) }, [ui.animId])

  const rows: Row[] = []
  const depth = new Map<Id, number>()
  for (const id of boneOrder(doc)) {
    const b = doc.skeleton.bones[id]
    const d = b.parentId ? (depth.get(b.parentId) ?? 0) + 1 : 0
    depth.set(id, d)
    rows.push({ kind: 'bone', id, name: b.name, depth: d })
  }
  for (const id of [...doc.partOrder].reverse()) rows.push({ kind: 'part', id, name: doc.parts[id].name, depth: 0 })

  const frameFromX = (clientX: number): number => {
    const grid = gridRef.current
    if (!grid || !anim) return 0
    const r = grid.getBoundingClientRect()
    const f = Math.floor((clientX - r.left + grid.scrollLeft) / CELL)
    return Math.max(0, Math.min(anim.frameCount - 1, f))
  }

  // scrubbing on the header
  const onHeaderDown = (e: React.PointerEvent<HTMLDivElement>) => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setUi({ frame: frameFromX(e.clientX), playing: false })
  }
  const onHeaderMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return
    setUi({ frame: frameFromX(e.clientX) })
  }

  // selection
  const toggleSel = (row: Row, frame: number) => {
    const k = refId(row.kind, row.id, frame)
    setSel(selSet.has(k)
      ? liveSel.filter(s => refId(s.kind, s.id, s.frame) !== k)
      : [...liveSel, { kind: row.kind, id: row.id, frame }])
  }

  const copySelection = () => {
    if (!anim || liveSel.length === 0) return
    const c = copyKeys(anim, liveSel)
    if (c) setClip(c)
  }
  const pasteAtPlayhead = () => {
    if (!anim || !clip) return
    const at = ui.frame
    const wrote = commit('Paste keys', d => {
      const a = d.animations[anim.id]
      if (a) pasteKeys(a, clip, at, (kind, id) => (kind === 'bone' ? !!d.skeleton.bones[id] : !!d.parts[id]))
    })
    if (wrote) setSel(pastedRefs(clip, at, anim.frameCount))
  }

  // Copy / paste with the keyboard as well as the transport buttons (phones have no keyboard).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || !(e.metaKey || e.ctrlKey)) return
      const k = e.key.toLowerCase()
      if (k === 'c' && liveSel.length > 0) { e.preventDefault(); copySelection() }
      else if (k === 'v' && clip) { e.preventDefault(); pasteAtPlayhead() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // key drags
  const onKeyDown = (e: React.PointerEvent<HTMLElement>, row: Row, frame: number) => {
    e.stopPropagation()
    // In multi-select, or with a modifier held, build the selection instead of starting a drag.
    if (multi || e.metaKey || e.ctrlKey || e.shiftKey) { toggleSel(row, frame); return }
    if (!selSet.has(refId(row.kind, row.id, frame))) setSel([{ kind: row.kind, id: row.id, frame }])
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    dragRef.current = { row, from: frame, to: frame, pointerId: e.pointerId, el }
    setUi({ frame, selectedBoneId: row.kind === 'bone' ? row.id : ui.selectedBoneId, playing: false })
    if (row.kind === 'part') editorStore.getState().selectPart(row.id)
    if (e.pointerType === 'touch') {
      longPressRef.current = window.setTimeout(async () => {
        if (dragRef.current && dragRef.current.from === dragRef.current.to && anim) {
          dragRef.current = null
          if (await askConfirm('Delete the keys at this frame?', { okLabel: 'Delete', danger: true })) {
            commit('Delete keys', d => { const a = d.animations[anim.id]; if (a) deleteRowKeys(a, row.kind, row.id, frame) })
          }
        }
      }, 600)
    }
  }
  const onKeyMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const to = frameFromX(e.clientX)
    if (to !== d.to) { d.to = to; d.el.style.transform = `translateX(${(to - d.from) * CELL}px)`; setUi({ frame: to }) }
  }
  const onKeyUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    clearTimeout(longPressRef.current)
    d.el.style.transform = ''
    dragRef.current = null
    if (d.to !== d.from && anim) {
      commit('Move keys', doc2 => { const a = doc2.animations[anim.id]; if (a) moveRowKeys(a, d.row.kind, d.row.id, d.from, d.to) })
      setSel([{ kind: d.row.kind, id: d.row.id, frame: d.to }])
    }
  }
  const onKeyContext = (e: React.MouseEvent, row: Row, frame: number) => {
    e.preventDefault()
    if (!anim) return
    commit('Delete keys', d => { const a = d.animations[anim.id]; if (a) deleteRowKeys(a, row.kind, row.id, frame) })
    setSel(cur => cur.filter(s => refId(s.kind, s.id, s.frame) !== refId(row.kind, row.id, frame)))
  }

  return (
    <div className="timeline">
      <Transport
        anim={anim}
        selected={liveSel.length}
        clip={clip}
        multi={multi}
        onToggleMulti={() => setMulti(v => !v)}
        onCopy={copySelection}
        onPaste={pasteAtPlayhead}
      />
      {!anim && (
        <div className="timeline__empty">
          <span>No animations yet.</span>
          <button className="primary" onClick={() => { promptNewAnimation() }}><Icon name="plus" size={16} /> Add animation</button>
        </div>
      )}
      {anim && (
        <div className="timeline__body">
          <div className="timeline__labels" onWheel={e => { if (gridRef.current) gridRef.current.scrollTop += e.deltaY }}>
            <div className="timeline__corner" />
            {/* Scrolled in step with the grid so a name always sits on its own row. */}
            <div className="timeline__labels-scroll" ref={labelsRef}>
              {rows.map(r => (
                <button
                  key={`${r.kind}:${r.id}`}
                  className={`timeline__label ${(r.kind === 'bone' ? ui.selectedBoneId === r.id : ui.selectedPartId === r.id) ? 'is-selected' : ''}`}
                  style={{ paddingLeft: 8 + r.depth * 10 }}
                  title={r.name}
                  onClick={() => r.kind === 'bone' ? setUi({ selectedBoneId: r.id }) : editorStore.getState().selectPart(r.id)}
                >
                  <Icon name={r.kind === 'bone' ? 'bone' : 'layers'} size={12} />
                  <span>{r.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="timeline__grid" ref={gridRef} onScroll={e => { if (labelsRef.current) labelsRef.current.scrollTop = e.currentTarget.scrollTop }}>
            <div className="timeline__header" style={{ width: anim.frameCount * CELL }} onPointerDown={onHeaderDown} onPointerMove={onHeaderMove}>
              {Array.from({ length: anim.frameCount }, (_, f) => (
                <div key={f} className={`timeline__hcell ${f === ui.frame ? 'is-current' : ''}`} style={{ width: CELL }}>{f + 1}</div>
              ))}
            </div>
            {rows.map(r => {
              const keys = rowKeyFrames(anim, r.kind, r.id)
              return (
                <div key={`${r.kind}:${r.id}`} className="timeline__row" style={{ width: anim.frameCount * CELL }}>
                  {Array.from({ length: anim.frameCount }, (_, f) => (
                    <div
                      key={f}
                      className={`timeline__cell ${f === ui.frame ? 'is-current' : ''}`}
                      style={{ width: CELL }}
                      onClick={e => { setUi({ frame: f }); if (!multi && !(e.metaKey || e.ctrlKey || e.shiftKey)) setSel([]) }}
                    >
                      {keys.has(f) && (
                        <span
                          className={`timeline__key ${selSet.has(refId(r.kind, r.id, f)) ? 'is-selected' : ''}`}
                          onPointerDown={e => onKeyDown(e, r, f)}
                          onPointerMove={onKeyMove}
                          onPointerUp={onKeyUp}
                          onPointerCancel={onKeyUp}
                          onClick={e => e.stopPropagation()}
                          onContextMenu={e => onKeyContext(e, r, f)}
                          title="Click to select · shift or ⌘/Ctrl-click to add · drag to move · right-click or long-press to delete"
                        >◆</span>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
            <div className="timeline__playhead" style={{ left: ui.frame * CELL + CELL / 2 }} />
          </div>
        </div>
      )}
    </div>
  )
}

interface TransportProps {
  anim: Animation | null
  selected: number
  clip: KeyClipboard | null
  multi: boolean
  onToggleMulti: () => void
  onCopy: () => void
  onPaste: () => void
}

function Transport({ anim, selected, clip, multi, onToggleMulti, onCopy, onPaste }: TransportProps) {
  const doc = useEditor(s => s.doc)
  const ui = useEditor(s => s.ui)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)

  const add = () => { promptNewAnimation() }
  const rename = async () => {
    if (!anim) return
    const name = await askText('Rename animation', { label: 'Name', defaultValue: anim.name, okLabel: 'Rename' })
    if (name) commit('Rename animation', d => { const a = d.animations[anim.id]; if (a) a.name = name })
  }
  const remove = async () => {
    if (!anim) return
    if (!(await askConfirm(`Delete animation “${anim.name}”?`, { message: 'Its keys are removed. This is undoable.', okLabel: 'Delete', danger: true }))) return
    commit('Delete animation', d => removeAnimation(d, anim.id))
  }

  return (
    <div className="transport">
      <select className="select" value={anim?.id ?? ''} onChange={e => setUi({ animId: e.target.value, frame: 0, playing: false })} title="Animation">
        {doc.animationOrder.map(id => <option key={id} value={id}>{doc.animations[id].name}</option>)}
      </select>
      <button className="icon-btn" title="Add animation" onClick={add}><Icon name="plus" size={16} /></button>
      <button className="icon-btn" title="Rename animation" onClick={rename} disabled={!anim}><Icon name="pencil" size={16} /></button>
      <button className="icon-btn" title="Delete animation" onClick={remove} disabled={!anim}><Icon name="trash" size={16} /></button>
      <span className="transport__sep" />
      <button className="icon-btn" title="Play / pause (Space)" disabled={!anim} onClick={() => setUi({ playing: !ui.playing })}><Icon name={ui.playing ? 'pause' : 'play'} /></button>
      <span className="transport__frame">{anim ? `${ui.frame + 1} / ${anim.frameCount}` : '–'}</span>
      {anim && (
        <>
          <label className="transport__field" title="Frames per second (0 holds the first frame)">
            <span>fps</span>
            <input inputMode="decimal" defaultValue={anim.fps} key={`fps${anim.id}${anim.fps}`} onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0 && v !== anim.fps) commit('Set fps', d => { const a = d.animations[anim.id]; if (a) a.fps = v }) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          </label>
          <label className="transport__field" title="Number of frames">
            <span>frames</span>
            <input inputMode="numeric" defaultValue={anim.frameCount} key={`fc${anim.id}${anim.frameCount}`} onBlur={e => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 1 && v !== anim.frameCount) commit('Set frame count', d => setFrameCount(d, anim.id, v)) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
          </label>
          <label className="transport__field transport__field--check" title="Loop, or play once and hold the last frame">
            <input type="checkbox" checked={anim.loop} onChange={e => commit('Set loop', d => { const a = d.animations[anim.id]; if (a) a.loop = e.target.checked })} />
            <span>loop</span>
          </label>
          <button className={`icon-btn ${ui.onion ? 'is-active' : ''}`} title="Onion skin (previous frame)" onClick={() => setUi({ onion: !ui.onion })}><Icon name="onion" size={16} /></button>
          <span className="transport__sep" />
          <button
            className={`icon-btn ${multi ? 'is-active' : ''}`}
            title="Pick several keyframes: tap each one to add or remove it"
            onClick={onToggleMulti}
          ><Icon name="select" size={16} /></button>
          <button
            className="icon-btn"
            disabled={selected === 0}
            title={selected === 0 ? 'Copy keyframes: click a diamond, shift or ⌘/Ctrl-click for more' : `Copy ${selected} keyframe${selected === 1 ? '' : 's'} (⌘/Ctrl+C)`}
            onClick={onCopy}
          ><Icon name="copy" size={16} /></button>
          <button
            className="icon-btn"
            disabled={!clip}
            title={clip ? `Paste ${clip.diamonds} keyframe${clip.diamonds === 1 ? '' : 's'} at the current frame (⌘/Ctrl+V)` : 'Paste keyframes at the current frame'}
            onClick={onPaste}
          ><Icon name="paste" size={16} /></button>
          {selected > 0 && <span className="transport__hint">{selected} selected</span>}
        </>
      )}
    </div>
  )
}
