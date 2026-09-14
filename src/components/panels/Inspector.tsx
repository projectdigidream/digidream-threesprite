import { getKey, removeKey, setKey } from '../../domain/animation'
import { restProjectedAngle, sampleBone, samplePart } from '../../domain/pose'
import { attachPart, boneOrder, ensureBoneTrack, ensurePartTrack, reparentBone, setPartSkin } from '../../domain/project'
import type { Animation, Bone, Id, Interp, Part, Vec3 } from '../../domain/types'
import { useEditor } from '../../store/editorStore'
import { Hint } from '../ui/Hint'
import { Icon } from '../ui/Icon'
import { InlineName } from '../ui/InlineName'
import { NumField } from '../ui/NumField'

export default function Inspector() {
  const mode = useEditor(s => s.ui.mode)
  return (
    <div className="panel inspector">
      <div className="panel__header"><Icon name="settings" size={16} /> {mode === 'animate' ? 'Keys at frame' : 'Inspector'}</div>
      {mode === 'animate' ? <AnimInspector /> : <RigInspector />}
    </div>
  )
}

/** Three numeric fields for a character-frame vector. */
function Vec3Fields({ label, value, step = 1, suffix, onCommit, badge }: { label: string; value: Vec3; step?: number; suffix?: string; onCommit: (v: Vec3) => void; badge?: React.ReactNode }) {
  return (
    <>
      <NumField label={`${label} right`} value={value.r} step={step} suffix={suffix} extra={badge} onCommit={v => onCommit({ ...value, r: v })} />
      <NumField label={`${label} up`} value={value.u} step={step} suffix={suffix} onCommit={v => onCommit({ ...value, u: v })} />
      <NumField label={`${label} forward`} value={value.f} step={step} suffix={suffix} onCommit={v => onCommit({ ...value, f: v })} />
    </>
  )
}

function RotFields({ label, value, onCommit, badge }: { label: string; value: Vec3; onCommit: (v: Vec3) => void; badge?: React.ReactNode }) {
  return (
    <>
      <NumField label={`${label} yaw`} value={value.u} suffix="°" extra={badge} title="Turn about the up axis" onCommit={v => onCommit({ ...value, u: v })} />
      <NumField label={`${label} pitch`} value={value.r} suffix="°" title="Tilt about the right axis" onCommit={v => onCommit({ ...value, r: v })} />
      <NumField label={`${label} roll`} value={value.f} suffix="°" title="Rotate about the forward axis (in the front view's plane)" onCommit={v => onCommit({ ...value, f: v })} />
    </>
  )
}

// ── rest pose ────────────────────────────────────────────────────────────────

function RigInspector() {
  const doc = useEditor(s => s.doc)
  const boneId = useEditor(s => s.ui.selectedBoneId)
  const partId = useEditor(s => s.ui.selectedPartId)
  const view = useEditor(s => s.ui.view)
  const commit = useEditor(s => s.commit)
  const bone = boneId ? doc.skeleton.bones[boneId] : null
  const part = partId ? doc.parts[partId] : null

  const setBone = (label: string, fn: (b: Bone) => void) => commit(label, d => { const b = boneId ? d.skeleton.bones[boneId] : null; if (b) fn(b) })
  const setPart = (label: string, fn: (p: Part) => void) => commit(label, d => { const p = partId ? d.parts[partId] : null; if (p) fn(p) })

  const descendants = new Set<Id>()
  if (bone) {
    const walk = (id: Id) => { descendants.add(id); for (const c of doc.skeleton.bones[id]?.children ?? []) walk(c) }
    walk(bone.id)
  }

  return (
    <div className="inspector__body">
      {bone ? (
        <section>
          <h4>Bone</h4>
          <label className="field"><span>Name</span><InlineName value={bone.name} onCommit={name => setBone('Rename bone', b => { b.name = name })} title="Bone name" /></label>
          <label className="field">
            <span>Parent</span>
            <select className="select" value={bone.parentId ?? ''} onChange={e => commit('Reparent bone', d => reparentBone(d, bone.id, e.target.value || null))}>
              <option value="">(none — root)</option>
              {Object.values(doc.skeleton.bones).filter(b => !descendants.has(b.id)).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <div className="numgrid numgrid--3">
            <Vec3Fields label="Pos" value={bone.rest.position} onCommit={v => setBone('Bone position', b => { b.rest.position = v })} />
            <RotFields label="Rot" value={bone.rest.rotation} onCommit={v => setBone('Bone rotation', b => { b.rest.rotation = v })} />
            <NumField label="Length" value={bone.length} min={1} onCommit={v => setBone('Bone length', b => { b.length = v })} />
          </div>
          <Hint>Position is in the parent bone's frame (the character's frame for roots: right / up / forward from the feet). A bone with zero rotation points up.</Hint>
        </section>
      ) : <div className="panel__empty">Select a bone.</div>}

      {part && (
        <section>
          <h4>Part</h4>
          <label className="field"><span>Name</span><InlineName value={part.name} onCommit={name => setPart('Rename part', p => { p.name = name })} title="Part name" /></label>
          <label className="field">
            <span>Bone</span>
            <select className="select" value={part.boneId} title="The part keeps its place in this view when it moves to another bone" onChange={e => { const id = e.target.value; commit('Attach part', d => { attachPart(d, part.id, id, view) }) }}>
              {Object.values(doc.skeleton.bones).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {part.solids ? (
            <Hint>A solids part: its 3D shapes live in the bone's frame. Edit them in the Solids panel.</Hint>
          ) : (
            <>
              <div className="numgrid">
                <NumField label="Offset along" value={part.offset.x} title="Along the projected bone" onCommit={v => setPart('Part offset', p => { p.offset.x = v })} />
                <NumField label="Offset across" value={part.offset.y} title="Perpendicular to the projected bone" onCommit={v => setPart('Part offset', p => { p.offset.y = v })} />
                <NumField label="Rotation" value={part.rotation} suffix="°" onCommit={v => setPart('Part rotation', p => { p.rotation = v })} />
                <NumField label="Pivot X" value={part.pivot.x} onCommit={v => setPart('Part pivot', p => { p.pivot.x = v })} />
                <NumField label="Pivot Y" value={part.pivot.y} onCommit={v => setPart('Part pivot', p => { p.pivot.y = v })} />
              </div>
              <label className="field field--row" title="Squash the image along the bone when the bone points towards the camera in a view">
                <input type="checkbox" checked={part.foreshorten} onChange={e => setPart('Foreshorten', p => { p.foreshorten = e.target.checked })} />
                <span>Foreshorten with the bone</span>
              </label>
              <div className="btn-row">
                <button className="text-btn" onClick={() => setPart('Upright part', p => { p.rotation = -restProjectedAngle(doc, p.boneId, 1) })}>Make upright (front view)</button>
                <button className="text-btn" onClick={() => setPart('Center pivot', p => { const img = Object.values(p.variants[p.defaultVariant]?.images ?? {})[0]; if (img) p.pivot = { x: Math.floor(img.width / 2), y: img.height } })}>Pivot at feet</button>
              </div>
              <Hint>Drag the pink pivot cross on the canvas to move where the image hangs on its bone. Images are drawn per view; the rig is shared.</Hint>
              <h4>Skin (bend between bones)</h4>
              <div className="skin__bones">
                {boneOrder(doc).filter(id => id !== part.boneId).map(id => (
                  <label key={id} className="field--row">
                    <input type="checkbox" checked={!!part.skin?.bones.includes(id)} onChange={e => commit('Skin bones', d => {
                      const cur = d.parts[part.id]?.skin?.bones ?? []
                      setPartSkin(d, part.id, { bones: e.target.checked ? [...cur, id] : cur.filter(b => b !== id) })
                    })} />
                    <span>{doc.skeleton.bones[id].name}</span>
                  </label>
                ))}
                {Object.keys(doc.skeleton.bones).length < 2 && <small>Add another bone to bend this part between them.</small>}
              </div>
              {part.skin && (
                <div className="numgrid">
                  <NumField label="Influence radius" value={part.skin.falloff} min={1} suffix="px" title="A vertex farther than this from a bone ignores it; larger = softer bends" onCommit={v => commit('Skin falloff', d => setPartSkin(d, part.id, { falloff: v }))} />
                  <NumField label="Grid cell" value={part.skin.cell} min={1} max={64} suffix="px" title="Deformation grid resolution (smaller = smoother)" onCommit={v => commit('Skin cell', d => setPartSkin(d, part.id, { cell: v }))} />
                </div>
              )}
              <Hint>The image is cut into a grid; each point follows the bones near it, so the art bends, stretches and twists between bones in the plane of each view. At rest it draws pixel-exactly.</Hint>
            </>
          )}
        </section>
      )}
    </div>
  )
}

// ── animation keys ───────────────────────────────────────────────────────────

const INTERPS: Interp[] = ['linear', 'easeInOut', 'step']

function AnimInspector() {
  const doc = useEditor(s => s.doc)
  const animId = useEditor(s => s.ui.animId)
  const frame = useEditor(s => s.ui.frame)
  const boneId = useEditor(s => s.ui.selectedBoneId)
  const partId = useEditor(s => s.ui.selectedPartId)
  const commit = useEditor(s => s.commit)
  const anim = animId ? doc.animations[animId] : null
  const bone = boneId ? doc.skeleton.bones[boneId] : null
  const part = partId ? doc.parts[partId] : null
  if (!anim) return <div className="panel__empty">No animation. Add one in the timeline.</div>

  const withAnim = (label: string, fn: (a: Animation) => void) => commit(label, d => { const a = d.animations[anim.id]; if (a) fn(a) })
  const bs = bone ? sampleBone(anim, bone.id, frame) : null
  const bt = bone ? anim.boneTracks[bone.id] : undefined
  const hasKey = (keys: { frame: number }[] | undefined) => !!keys?.some(k => k.frame === frame)
  const keyBadge = (has: boolean, onToggle: () => void, title: string) => (
    <button type="button" className={`key-badge ${has ? 'is-keyed' : ''}`} title={title} onClick={onToggle}>◆</button>
  )
  const ps = part ? samplePart(anim, part, frame) : null
  const pt = part ? anim.partTracks[part.id] : undefined
  const interpAt = bt ? (getKey(bt.rotation, frame) ?? getKey(bt.translate, frame) ?? getKey(bt.scale, frame))?.interp : undefined

  return (
    <div className="inspector__body">
      <Hint>Frame {frame + 1} of {anim.frameCount} · drag bone handles on the canvas to key them (rotating in the plane of the current view), or type values here.</Hint>
      {bone && bs ? (
        <section>
          <h4>{bone.name}</h4>
          <div className="numgrid numgrid--3">
            <RotFields label="Rot" value={bs.rotation} badge={keyBadge(hasKey(bt?.rotation), () => withAnim('Toggle key', a => { const t = ensureBoneTrack(a, bone.id); if (!removeKey(t.rotation, frame)) setKey(t.rotation, frame, { ...bs.rotation }) }), 'Rotation key at this frame')}
              onCommit={v => withAnim('Key rotation', a => setKey(ensureBoneTrack(a, bone.id).rotation, frame, v))} />
            <Vec3Fields label="Move" value={bs.translate} badge={keyBadge(hasKey(bt?.translate), () => withAnim('Toggle key', a => { const t = ensureBoneTrack(a, bone.id); if (!removeKey(t.translate, frame)) setKey(t.translate, frame, { ...bs.translate }) }), 'Move key at this frame')}
              onCommit={v => withAnim('Key move', a => setKey(ensureBoneTrack(a, bone.id).translate, frame, v))} />
            <Vec3Fields label="Scale" value={bs.scale} step={0.1} badge={keyBadge(hasKey(bt?.scale), () => withAnim('Toggle key', a => { const t = ensureBoneTrack(a, bone.id); if (!removeKey(t.scale, frame)) setKey(t.scale, frame, { ...bs.scale }) }), 'Scale key at this frame')}
              onCommit={v => withAnim('Key scale', a => setKey(ensureBoneTrack(a, bone.id).scale, frame, v))} />
          </div>
          <div className="btn-row">
            <label className="field field--row"><span>Ease</span>
              <select className="select" value={interpAt ?? 'linear'} disabled={!interpAt} onChange={e => withAnim('Key interpolation', a => { const t = a.boneTracks[bone.id]; if (!t) return; for (const keys of [t.rotation, t.translate, t.scale] as { frame: number; interp: Interp }[][]) { const k = keys.find(x => x.frame === frame); if (k) k.interp = e.target.value as Interp } })}>
                {INTERPS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
            <button className="text-btn" onClick={() => withAnim('Key all', a => { const t = ensureBoneTrack(a, bone.id); setKey(t.rotation, frame, { ...bs.rotation }); setKey(t.translate, frame, { ...bs.translate }); setKey(t.scale, frame, { ...bs.scale }) })}>Key all</button>
            <button className="text-btn" onClick={() => withAnim('Delete keys', a => { const t = a.boneTracks[bone.id]; if (!t) return; removeKey(t.rotation, frame); removeKey(t.translate, frame); removeKey(t.scale, frame) })}>Delete keys</button>
          </div>
        </section>
      ) : <div className="panel__empty">Select a bone in the timeline.</div>}
      {part && ps && (
        <section>
          <h4>{part.name}</h4>
          <label className="field field--row">
            <input type="checkbox" checked={ps.visible} onChange={e => withAnim('Key visibility', a => setKey(ensurePartTrack(a, part.id).visible, frame, e.target.checked, 'step'))} />
            <span>Visible {keyBadge(hasKey(pt?.visible), () => withAnim('Toggle key', a => { const t = ensurePartTrack(a, part.id); if (!removeKey(t.visible, frame)) setKey(t.visible, frame, ps.visible, 'step') }), 'Visibility key at this frame')}</span>
          </label>
          {!part.solids && (
            <label className="field">
              <span>Variant {keyBadge(hasKey(pt?.variant), () => withAnim('Toggle key', a => { const t = ensurePartTrack(a, part.id); if (!removeKey(t.variant, frame)) setKey(t.variant, frame, ps.variantId, 'step') }), 'Variant key at this frame')}</span>
              <select className="select" value={ps.variantId} onChange={e => withAnim('Key variant', a => setKey(ensurePartTrack(a, part.id).variant, frame, e.target.value, 'step'))}>
                {part.variantOrder.map(v => <option key={v} value={v}>{part.variants[v].name}</option>)}
              </select>
            </label>
          )}
        </section>
      )}
    </div>
  )
}
