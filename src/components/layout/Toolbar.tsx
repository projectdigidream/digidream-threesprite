import { useNeedsSave } from '../../hooks/useAutosave'
import { useLandscape } from '../../hooks/useIsMobile'
import { canRedo, canUndo, useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'
import TabBar from './TabBar'

interface Props {
  compact?: boolean
  onMenu: () => void
  onSettings: () => void
  onHelp: () => void
}

export default function Toolbar({ compact = false, onMenu, onSettings, onHelp }: Props) {
  const name = useEditor(s => s.doc.name)
  const unsaved = useNeedsSave()
  const undoable = useEditor(canUndo)
  const redoable = useEditor(canRedo)
  const undo = useEditor(s => s.undo)
  const redo = useEditor(s => s.redo)
  const N = useEditor(s => s.doc.views.count)
  const mirror = useEditor(s => s.doc.views.mirror)
  const size = useEditor(s => s.doc.canvas.size)
  // A phone keeps the modes in a bottom bar when upright. Sideways, height is
  // what runs out: they move up here, where there is width to spare.
  const landscape = useLandscape()
  const modesHere = !compact || landscape

  return (
    <header className="toolbar">
      <button className="icon-btn" title="Project menu (new, open, save)" aria-label="Project menu" onClick={onMenu}><Icon name="menu" /></button>
      <button className="toolbar__title" title="Project settings" onClick={onSettings}>
        <span className="toolbar__name">{name}{unsaved ? ' •' : ''}</span>
        {!compact && <span className="toolbar__meta">{size}px · {N} views{mirror ? ' · mirrored' : ''}</span>}
      </button>
      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!undoable} onClick={undo}><Icon name="undo" /></button>
      <button className="icon-btn" title="Redo (Shift+Ctrl+Z)" disabled={!redoable} onClick={redo}><Icon name="redo" /></button>
      <span className="spacer" />
      {modesHere && <TabBar />}
      <span className="spacer" />
      {!compact && <button className="icon-btn" title="Shortcuts and gestures (?)" aria-label="Help" onClick={onHelp}><span className="toolbar__help">?</span></button>}
      <button className="icon-btn" title="Project settings" aria-label="Project settings" onClick={onSettings}><Icon name="settings" /></button>
    </header>
  )
}
