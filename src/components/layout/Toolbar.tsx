import { canRedo, canUndo, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'
import TabBar from './TabBar'

interface Props {
  compact?: boolean
  onNew: () => void
  onSettings: () => void
}

export default function Toolbar({ compact = false, onNew, onSettings }: Props) {
  const name = useEditor(s => s.doc.name)
  const dirty = useEditor(s => s.dirty)
  const undoable = useEditor(canUndo)
  const redoable = useEditor(canRedo)
  const undo = useEditor(s => s.undo)
  const redo = useEditor(s => s.redo)
  const N = useEditor(s => s.doc.views.count)
  const mirror = useEditor(s => s.doc.views.mirror)
  const size = useEditor(s => s.doc.canvas.size)

  return (
    <header className="toolbar">
      <button className="icon-btn" title="New project" onClick={onNew}><Icon name="new" /></button>
      <button className="toolbar__title" title="Project settings" onClick={onSettings}>
        <span className="toolbar__name">{name}{dirty ? ' •' : ''}</span>
        {!compact && <span className="toolbar__meta">{size}px · {N} views{mirror ? ' · mirrored' : ''}</span>}
      </button>
      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!undoable} onClick={undo}><Icon name="undo" /></button>
      <button className="icon-btn" title="Redo (Shift+Ctrl+Z)" disabled={!redoable} onClick={redo}><Icon name="redo" /></button>
      <span className="spacer" />
      {!compact && <TabBar />}
      <span className="spacer" />
      <button className="icon-btn" title="Project settings" onClick={onSettings}><Icon name="settings" /></button>
    </header>
  )
}
