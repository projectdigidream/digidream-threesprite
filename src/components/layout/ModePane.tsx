import type { Mode } from '../../store/editorStore'
import ExportPanel from '../export/ExportPanel'
import BoneTree from '../panels/BoneTree'
import Inspector from '../panels/Inspector'
import Timeline from '../timeline/Timeline'

interface Props { mode: Mode; side?: boolean; bottom?: boolean }

/**
 * Mode-specific side/bottom panes. Rig → bone tree + inspector; Animate →
 * inspector (side) and timeline (bottom). The studio (3D) and export modes
 * have their own layouts.
 */
export default function ModePane({ mode, side, bottom }: Props) {
  if (side) {
    if (mode === 'rig') return <><BoneTree /><Inspector /></>
    if (mode === 'animate') return <Inspector />
    return null
  }
  if (bottom) {
    if (mode === 'animate') return <Timeline />
    return null
  }
  if (mode === 'export') return <ExportPanel />
  return null
}
