import type { Mode } from '../../store/editorStore'

interface Props { mode: Mode; side?: boolean; bottom?: boolean }

/**
 * Mode-specific panes. Filled in by later milestones: Rig → Inspector + BoneTree,
 * Animate → Timeline, 3D → Preview3D, Export → ExportPanel.
 */
export default function ModePane({ mode, side, bottom }: Props) {
  if (side) {
    if (mode === 'rig') return <div className="panel"><div className="panel__header">Inspector</div><div className="panel__empty">Rig editing arrives in the next milestone.</div></div>
    if (mode === 'preview') return <div className="panel"><div className="panel__header">Preview</div><div className="panel__empty">3D preview controls arrive with the preview.</div></div>
    return null
  }
  if (bottom) {
    if (mode === 'animate') return <div className="panel panel--timeline"><div className="panel__header">Timeline</div><div className="panel__empty">Timeline arrives in the next milestone.</div></div>
    return null
  }
  if (mode === 'preview') return <div className="pane-placeholder">3D preview arrives in milestone 4.</div>
  if (mode === 'export') return <div className="pane-placeholder">Export arrives in milestone 5.</div>
  return null
}
