import { addBone, boneOrder, removeBone } from '../../domain/project'
import type { Id } from '../../domain/types'
import { useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

export default function BoneTree() {
  const doc = useEditor(s => s.doc)
  const selectedBoneId = useEditor(s => s.ui.selectedBoneId)
  const rigTool = useEditor(s => s.ui.rigTool)
  const mode = useEditor(s => s.ui.mode)
  const setUi = useEditor(s => s.setUi)
  const commit = useEditor(s => s.commit)

  const depth = new Map<Id, number>()
  for (const id of boneOrder(doc)) {
    const b = doc.skeleton.bones[id]
    depth.set(id, b.parentId ? (depth.get(b.parentId) ?? 0) + 1 : 0)
  }

  const addChild = () => {
    const parent = selectedBoneId ? doc.skeleton.bones[selectedBoneId] : null
    let id: Id | null = null
    commit('Add bone', d => {
      id = addBone(d, parent
        ? { parentId: parent.id, rest: { position: { u: parent.length } }, length: Math.max(4, Math.round(parent.length * 0.7)) }
        : { length: Math.round(d.canvas.size / 3) }).id
    })
    if (id) setUi({ selectedBoneId: id })
  }
  const remove = () => {
    if (!selectedBoneId) return
    const b = doc.skeleton.bones[selectedBoneId]
    if (Object.keys(doc.skeleton.bones).length <= 1) { window.alert('A rig needs at least one bone.'); return }
    if (!window.confirm(`Delete bone "${b.name}"? Its children and parts move to its parent.`)) return
    commit('Delete bone', d => removeBone(d, selectedBoneId))
  }

  return (
    <div className="panel bone-tree">
      <div className="panel__header">
        <Icon name="bone" size={16} /> Bones
        <span className="spacer" />
        {mode === 'rig' && (
          <button className={`icon-btn ${rigTool === 'addBone' ? 'is-active' : ''}`} title="Draw a new bone on the canvas: press at the root, drag to the tip (child of the selected bone)" onClick={() => setUi({ rigTool: rigTool === 'addBone' ? 'select' : 'addBone' })}>
            <Icon name="pencil" size={16} />
          </button>
        )}
        <button className="icon-btn" title="Add child bone" onClick={addChild}><Icon name="plus" size={16} /></button>
        <button className="icon-btn" title="Delete bone" onClick={remove} disabled={!selectedBoneId}><Icon name="trash" size={16} /></button>
      </div>
      <div className="bone-tree__rows">
        {boneOrder(doc).map(id => {
          const b = doc.skeleton.bones[id]
          return (
            <button key={id} className={`row ${id === selectedBoneId ? 'is-selected' : ''}`} style={{ paddingLeft: 12 + (depth.get(id) ?? 0) * 14 }} onClick={() => setUi({ selectedBoneId: id })}>
              <Icon name="bone" size={12} />
              <span className="row__name">{b.name}</span>
              <span className="row__meta">{Object.values(doc.parts).filter(p => p.boneId === id).length || ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
