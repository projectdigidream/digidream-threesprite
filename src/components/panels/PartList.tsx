import { addPart, addVariant, movePartOrder, removePart, removeVariant } from '../../domain/project'
import { askConfirm, askText } from '../../core/ui/dialogs'
import { editorStore, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

export default function PartList() {
  const partOrder = useEditor(s => s.doc.partOrder)
  const parts = useEditor(s => s.doc.parts)
  const bones = useEditor(s => s.doc.skeleton.bones)
  const selectedPartId = useEditor(s => s.ui.selectedPartId)
  const selectedBoneId = useEditor(s => s.ui.selectedBoneId)
  const variantId = useEditor(s => s.ui.variantId)
  const selectPart = useEditor(s => s.selectPart)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)

  const selected = selectedPartId ? parts[selectedPartId] : null

  const add = () => {
    const boneId = selectedBoneId ?? editorStore.getState().doc.skeleton.rootOrder[0]
    if (!boneId) return
    let newId: string | null = null
    commit('Add part', d => { newId = addPart(d, { boneId }).id })
    if (newId) selectPart(newId)
  }
  const rename = async () => {
    if (!selected) return
    const name = await askText('Rename part', { label: 'Name', defaultValue: selected.name, okLabel: 'Rename' })
    if (name) commit('Rename part', d => { const p = d.parts[selected.id]; if (p) p.name = name })
  }
  const remove = async () => {
    if (!selected) return
    if (!(await askConfirm(`Delete part “${selected.name}”?`, { message: 'Its images and keys are removed. This is undoable.', okLabel: 'Delete', danger: true }))) return
    commit('Delete part', d => removePart(d, selected.id))
  }
  const move = (dir: 1 | -1) => {
    if (!selected) return
    const i = partOrder.indexOf(selected.id)
    commit('Reorder parts', d => movePartOrder(d, selected.id, i + dir))
  }
  const addVar = async () => {
    if (!selected) return
    const name = await askText('New variant', { label: 'Name (e.g. “open hand”)', placeholder: 'variant', okLabel: 'Add' })
    if (!name) return
    let vid: string | null = null
    commit('Add variant', d => { vid = addVariant(d, selected.id, name).id })
    if (vid) setUi({ variantId: vid })
  }
  const removeVar = async () => {
    if (!selected || !variantId || selected.variantOrder.length <= 1) return
    if (!(await askConfirm(`Delete variant “${selected.variants[variantId]?.name}”?`, { okLabel: 'Delete', danger: true }))) return
    commit('Delete variant', d => removeVariant(d, selected.id, variantId))
  }

  // painter's order: last in the list is on top, so show the list reversed (top first)
  const rows = [...partOrder].reverse()

  return (
    <div className="panel part-list">
      <div className="panel__header">
        <Icon name="layers" size={16} /> Parts
        <span className="spacer" />
        <button className="icon-btn" title="Add part on the selected bone" onClick={add}><Icon name="plus" size={16} /></button>
      </div>
      <div className="part-list__rows">
        {rows.map(id => {
          const p = parts[id]
          return (
            <button key={id} className={`row ${id === selectedPartId ? 'is-selected' : ''}`} onClick={() => selectPart(id)} onDoubleClick={rename}>
              <span className="row__name">{p.name}</span>
              <span className="row__meta">{bones[p.boneId]?.name ?? '?'}</span>
            </button>
          )
        })}
        {rows.length === 0 && <div className="panel__empty">No parts yet.</div>}
      </div>
      {selected && (
        <div className="part-list__actions">
          <button className="icon-btn" title="Bring forward" onClick={() => move(1)} disabled={partOrder.indexOf(selected.id) === partOrder.length - 1}><Icon name="up" size={16} /></button>
          <button className="icon-btn" title="Send backward" onClick={() => move(-1)} disabled={partOrder.indexOf(selected.id) === 0}><Icon name="down" size={16} /></button>
          <button className="icon-btn" title="Rename" onClick={rename}><Icon name="pencil" size={16} /></button>
          <button className="icon-btn" title="Delete part" onClick={remove}><Icon name="trash" size={16} /></button>
          <span className="spacer" />
          <select className="select" value={variantId ?? ''} onChange={e => setUi({ variantId: e.target.value })} title="Variant (swappable image set)">
            {selected.variantOrder.map(vid => <option key={vid} value={vid}>{selected.variants[vid].name}</option>)}
          </select>
          <button className="icon-btn" title="Add variant" onClick={addVar}><Icon name="plus" size={16} /></button>
          <button className="icon-btn" title="Delete variant" onClick={removeVar} disabled={selected.variantOrder.length <= 1}><Icon name="close" size={16} /></button>
        </div>
      )}
    </div>
  )
}
