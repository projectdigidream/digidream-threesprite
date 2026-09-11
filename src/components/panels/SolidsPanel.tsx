import { PRIMITIVE_KINDS } from '../../domain/solids'
import { addPrimitive, addSolidsPart, convertSolidsToPixels, duplicatePrimitive, movePrimitiveOrder, removePrimitive, updatePrimitive, updateShading } from '../../domain/solidsOps'
import { rgbaToHex } from '../../domain/palette'
import type { Id, PrimitiveKind, Vec3 } from '../../domain/types'
import { useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'
import { NumField } from '../ui/NumField'

const KIND_LABEL: Record<PrimitiveKind, string> = { cube: 'Cube', sphere: 'Sphere', cylinder: 'Cylinder', cone: 'Cone', pyramid: 'Pyramid' }

/**
 * 3D primitives of the selected solids part. They render into every view at
 * once from one description, so shape, occlusion and lighting stay consistent
 * from every angle; the rig animates them in 3D.
 */
export default function SolidsPanel({ compact = false }: { compact?: boolean }) {
  const doc = useEditor(s => s.doc)
  const partId = useEditor(s => s.ui.selectedPartId)
  const primId = useEditor(s => s.ui.selectedPrimitiveId)
  const boneId = useEditor(s => s.ui.selectedBoneId)
  const primary = useEditor(s => s.ui.primary)
  const commit = useEditor(s => s.commit)
  const setUi = useEditor(s => s.setUi)
  const selectPart = useEditor(s => s.selectPart)
  const part = partId ? doc.parts[partId] : null
  const group = part?.solids
  const prim = group && primId ? group.primitives[primId] : null

  const addPart = () => {
    const bone = boneId ?? doc.skeleton.rootOrder[0]
    if (!bone) return
    let id: Id | null = null
    commit('Add solids part', d => { id = addSolidsPart(d, bone).id })
    if (id) selectPart(id)
  }
  const add = (kind: PrimitiveKind) => {
    if (!part?.solids) return
    let id: Id | null = null
    commit(`Add ${kind}`, d => { id = addPrimitive(d, part.id, kind, primary).id })
    if (id) setUi({ selectedPrimitiveId: id, tool: 'move' })
  }
  const edit = (label: string, fn: (v: NonNullable<typeof prim>) => void) => {
    if (!part || !prim) return
    commit(label, d => updatePrimitive(d, part.id, prim.id, fn as never))
  }
  const vec = (label: string, key: 'position' | 'size' | 'rotation', v: Vec3) => edit(label, q => { q[key] = v })

  if (!part) return <div className="panel"><div className="panel__header"><Icon name="cube" size={16} /> Solids</div><div className="panel__empty">Select or add a part.</div></div>
  if (!group) {
    return (
      <div className="panel">
        <div className="panel__header"><Icon name="cube" size={16} /> Solids</div>
        <div className="panel__empty">
          Build the character out of 3D shapes: every view is rendered from the same shapes, so they always agree.
          <div className="btn-row" style={{ marginTop: 8 }}><button className="text-btn" onClick={addPart}><Icon name="plus" size={14} /> Add a solids part on “{boneId ? doc.skeleton.bones[boneId]?.name : 'root'}”</button></div>
        </div>
      </div>
    )
  }

  return (
    <div className={`panel solids ${compact ? 'solids--compact' : ''}`}>
      <div className="panel__header">
        <Icon name="cube" size={16} /> Solids · {part.name}
        <span className="spacer" />
        <button className="text-btn" title="Keep the rendered pixels and drop the 3D shapes so you can paint on them" onClick={() => { if (window.confirm('Bake the solids into pixels? The 3D shapes are removed (undoable).')) commit('Bake solids', d => convertSolidsToPixels(d, part.id)) }}>Bake</button>
      </div>
      <div className="solids__add">
        {PRIMITIVE_KINDS.map(k => <button key={k} className="chip" onClick={() => add(k)} title={`Add a ${KIND_LABEL[k].toLowerCase()} in the primary colour`}>+ {KIND_LABEL[k]}</button>)}
      </div>
      <div className="solids__rows">
        {group.order.map(id => {
          const q = group.primitives[id]
          return (
            <button key={id} className={`row ${id === primId ? 'is-selected' : ''}`} onClick={() => setUi({ selectedPrimitiveId: id })}>
              <span className="swatch" style={{ background: rgbaToHex(q.color), width: 14, height: 14, minWidth: 14, minHeight: 14 }} />
              <span className="row__name">{q.name}</span>
              <span className="row__meta">{KIND_LABEL[q.kind]}{q.visible ? '' : ' · hidden'}</span>
            </button>
          )
        })}
        {group.order.length === 0 && <div className="panel__empty">No shapes yet. Add one above, then drag it with the Move tool in any view.</div>}
      </div>
      {prim && (
        <div className="inspector__body">
          <div className="part-list__actions">
            <input value={prim.name} onChange={e => edit('Rename solid', q => { q.name = e.target.value })} style={{ flex: 1, minWidth: 0 }} />
            <button className="icon-btn" title="Move up" onClick={() => commit('Reorder solids', d => movePrimitiveOrder(d, part.id, prim.id, -1))}><Icon name="up" size={14} /></button>
            <button className="icon-btn" title="Move down" onClick={() => commit('Reorder solids', d => movePrimitiveOrder(d, part.id, prim.id, 1))}><Icon name="down" size={14} /></button>
            <button className="icon-btn" title="Duplicate" onClick={() => { let id: Id | null = null; commit('Duplicate solid', d => { id = duplicatePrimitive(d, part.id, prim.id)?.id ?? null }); if (id) setUi({ selectedPrimitiveId: id }) }}><Icon name="copy" size={14} /></button>
            <button className="icon-btn" title="Delete" onClick={() => commit('Delete solid', d => removePrimitive(d, part.id, prim.id))}><Icon name="trash" size={14} /></button>
          </div>
          <div className="btn-row">
            <label className="field field--row"><input type="checkbox" checked={prim.visible} onChange={e => edit('Toggle solid', q => { q.visible = e.target.checked })} /><span>Visible</span></label>
            <label className="field field--row"><span>Kind</span>
              <select className="select" value={prim.kind} onChange={e => edit('Change kind', q => { q.kind = e.target.value as PrimitiveKind })}>
                {PRIMITIVE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <button className="text-btn" onClick={() => edit('Recolour solid', q => { q.color = [primary[0], primary[1], primary[2], 255] })}>
              <span className="swatch" style={{ background: rgbaToHex(prim.color), width: 14, height: 14, minWidth: 14, minHeight: 14 }} /> Use primary colour
            </button>
          </div>
          <div className="numgrid numgrid--3">
            <NumField label="Pos right" value={prim.position.r} onCommit={v => vec('Move solid', 'position', { ...prim.position, r: v })} />
            <NumField label="Pos up" value={prim.position.u} onCommit={v => vec('Move solid', 'position', { ...prim.position, u: v })} />
            <NumField label="Pos forward" value={prim.position.f} onCommit={v => vec('Move solid', 'position', { ...prim.position, f: v })} />
            <NumField label="Width" value={prim.size.r} min={1} onCommit={v => vec('Resize solid', 'size', { ...prim.size, r: v })} />
            <NumField label="Height" value={prim.size.u} min={1} onCommit={v => vec('Resize solid', 'size', { ...prim.size, u: v })} />
            <NumField label="Depth" value={prim.size.f} min={1} onCommit={v => vec('Resize solid', 'size', { ...prim.size, f: v })} />
            <NumField label="Yaw" value={prim.rotation.u} suffix="°" onCommit={v => vec('Rotate solid', 'rotation', { ...prim.rotation, u: v })} />
            <NumField label="Pitch" value={prim.rotation.r} suffix="°" onCommit={v => vec('Rotate solid', 'rotation', { ...prim.rotation, r: v })} />
            <NumField label="Roll" value={prim.rotation.f} suffix="°" onCommit={v => vec('Rotate solid', 'rotation', { ...prim.rotation, f: v })} />
          </div>
          <small>Positions are in the bone's frame (right / up / forward). With the Move tool, dragging in any view moves the shape in that view's plane.</small>
        </div>
      )}
      <div className="inspector__body">
        <h4>Shading</h4>
        <div className="btn-row">
          <label className="field field--row"><span>Tones</span>
            <select className="select" value={group.shading.levels} onChange={e => commit('Solids shading', d => updateShading(d, part.id, { levels: Number(e.target.value) }))}>
              {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field field--row"><input type="checkbox" checked={group.shading.outline} onChange={e => commit('Solids shading', d => updateShading(d, part.id, { outline: e.target.checked }))} /><span>Outline</span></label>
          <label className="field field--row"><span>Light</span>
            <select className="select" value={group.shading.lightSpace} onChange={e => commit('Solids shading', d => updateShading(d, part.id, { lightSpace: e.target.value as 'view' | 'character' }))}>
              <option value="view">fixed to the viewer</option>
              <option value="character">turns with the character</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}
