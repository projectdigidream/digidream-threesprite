import { useEditor, type Mode } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

export const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: 'draw', label: 'Draw', icon: 'pencil' },
  { id: 'rig', label: 'Rig', icon: 'bone' },
  { id: 'animate', label: 'Animate', icon: 'film' },
  { id: 'preview', label: '3D', icon: 'cube' },
  { id: 'export', label: 'Export', icon: 'export' },
]

export default function TabBar({ bottom = false }: { bottom?: boolean }) {
  const mode = useEditor(s => s.ui.mode)
  const setUi = useEditor(s => s.setUi)
  return (
    <nav className={`tab-bar ${bottom ? 'tab-bar--bottom' : ''}`} aria-label="Mode">
      {MODES.map(m => (
        <button key={m.id} className={`tab ${mode === m.id ? 'is-active' : ''}`} onClick={() => setUi({ mode: m.id, playing: false })} aria-current={mode === m.id}>
          <Icon name={m.icon} size={bottom ? 20 : 16} />
          <span>{m.label}</span>
        </button>
      ))}
    </nav>
  )
}
