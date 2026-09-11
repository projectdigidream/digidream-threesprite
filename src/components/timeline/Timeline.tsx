import { useRef } from 'react'
import { moveKey, removeKey } from '../../domain/animation'
import { addAnimation, boneOrder, removeAnimation, setFrameCount } from '../../domain/project'
import type { Animation, Id, Key } from '../../domain/types'
import { editorStore, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

const CELL = 20

type RowKind = 'bone' | 'part'
interface Row { kind: RowKind; id: Id; name: string; depth: number }

/** Every key list of a row, typed loosely: the timeline only reads/moves frames. */
function tracksOf(anim: Animation, row: Row): Key<unknown>[][] {
  if (row.kind === 'bone') {
    const t = anim.boneTracks[row.id]
    return t ? [t.rotation, t.translate, t.scale] : []
  }
  const t = anim.partTracks[row.id]
  return t ? [t.visible, t.variant] : []
}

function keyFrames(anim: Animation, row: Row): Set<number> {
  const out = new Set<number>()
  for (const keys of tracksOf(anim, row)) for (const k of keys) out.add(k.frame)
  return out
}

function moveRowKeys(anim: Animation, row: Row, from: number, to: number): void {
  for (const keys of tracksOf(anim, row)) moveKey(keys, from, to)
}

function deleteRowKeys(anim: Animation, row: Row, frame: number): void {
  for (const keys of tracksOf(anim, row)) removeKey(keys, frame)
}

export default function Timeline() {
  const doc = useEditor(s => s.doc)
  const ui = useEditor(s => s.ui)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)
  const anim = ui.animId ? doc.animations[ui.animId] : null
  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ row: Row; from: number; to: number; pointerId: number; el: HTMLElement } | null>(null)
  const longPressRef = useRef(0)

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

  // key drags
  const onKeyDown = (e: React.PointerEvent<HTMLElement>, row: Row, frame: number) => {
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    dragRef.current = { row, from: frame, to: frame, pointerId: e.pointerId, el }
    setUi({ frame, selectedBoneId: row.kind === 'bone' ? row.id : ui.selectedBoneId, playing: false })
    if (row.kind === 'part') editorStore.getState().selectPart(row.id)
    if (e.pointerType === 'touch') {
      longPressRef.current = window.setTimeout(() => {
        if (dragRef.current && dragRef.current.from === dragRef.current.to && anim && window.confirm('Delete keys at this frame?')) {
          commit('Delete keys', d => { const a = d.animations[anim.id]; if (a) deleteRowKeys(a, row, frame) })
          dragRef.current = null
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
    if (d.to !== d.from && anim) commit('Move keys', doc2 => { const a = doc2.animations[anim.id]; if (a) moveRowKeys(a, d.row, d.from, d.to) })
  }
  const onKeyContext = (e: React.MouseEvent, row: Row, frame: number) => {
    e.preventDefault()
    if (!anim) return
    commit('Delete keys', d => { const a = d.animations[anim.id]; if (a) deleteRowKeys(a, row, frame) })
  }

  return (
    <div className="timeline">
      <Transport anim={anim} />
      {anim && (
        <div className="timeline__body">
          <div className="timeline__labels">
            <div className="timeline__corner" />
            {rows.map(r => (
              <button
                key={`${r.kind}:${r.id}`}
                className={`timeline__label ${(r.kind === 'bone' ? ui.selectedBoneId === r.id : ui.selectedPartId === r.id) ? 'is-selected' : ''}`}
                style={{ paddingLeft: 8 + r.depth * 10 }}
                onClick={() => r.kind === 'bone' ? setUi({ selectedBoneId: r.id }) : editorStore.getState().selectPart(r.id)}
              >
                <Icon name={r.kind === 'bone' ? 'bone' : 'layers'} size={12} />
                <span>{r.name}</span>
              </button>
            ))}
          </div>
          <div className="timeline__grid" ref={gridRef}>
            <div className="timeline__header" style={{ width: anim.frameCount * CELL }} onPointerDown={onHeaderDown} onPointerMove={onHeaderMove}>
              {Array.from({ length: anim.frameCount }, (_, f) => (
                <div key={f} className={`timeline__hcell ${f === ui.frame ? 'is-current' : ''}`} style={{ width: CELL }}>{f + 1}</div>
              ))}
            </div>
            {rows.map(r => {
              const keys = keyFrames(anim, r)
              return (
                <div key={`${r.kind}:${r.id}`} className="timeline__row" style={{ width: anim.frameCount * CELL }}>
                  {Array.from({ length: anim.frameCount }, (_, f) => (
                    <div key={f} className={`timeline__cell ${f === ui.frame ? 'is-current' : ''}`} style={{ width: CELL }} onClick={() => setUi({ frame: f })}>
                      {keys.has(f) && (
                        <span
                          className="timeline__key"
                          onPointerDown={e => onKeyDown(e, r, f)}
                          onPointerMove={onKeyMove}
                          onPointerUp={onKeyUp}
                          onPointerCancel={onKeyUp}
                          onContextMenu={e => onKeyContext(e, r, f)}
                          title="Drag to move · right-click / long-press to delete"
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

function Transport({ anim }: { anim: Animation | null }) {
  const doc = useEditor(s => s.doc)
  const ui = useEditor(s => s.ui)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)

  const add = () => {
    const name = window.prompt('Animation name', `anim ${doc.animationOrder.length + 1}`)
    if (!name) return
    let id: Id | null = null
    commit('Add animation', d => { id = addAnimation(d, { name }).id })
    if (id) setUi({ animId: id, frame: 0 })
  }
  const rename = () => {
    if (!anim) return
    const name = window.prompt('Animation name', anim.name)
    if (name && name.trim()) commit('Rename animation', d => { const a = d.animations[anim.id]; if (a) a.name = name.trim() })
  }
  const remove = () => {
    if (!anim || !window.confirm(`Delete animation "${anim.name}"?`)) return
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
        </>
      )}
    </div>
  )
}
