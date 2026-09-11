import { useEditor } from '../../store/editorStore'
import PixelCanvas from '../canvas/PixelCanvas'
import PalettePanel from '../panels/PalettePanel'
import PartList from '../panels/PartList'
import ToolPanel from '../panels/ToolPanel'
import ViewStrip from '../panels/ViewStrip'
import ModePane from './ModePane'

export default function DesktopLayout() {
  const mode = useEditor(s => s.ui.mode)
  const canvasMode = mode === 'draw' || mode === 'rig' || mode === 'animate'
  return (
    <div className={`desktop desktop--${mode}`}>
      <aside className="desktop__left">
        {mode === 'draw' && <ToolPanel />}
      </aside>
      <main className="desktop__center">
        {canvasMode && <ViewStrip />}
        {canvasMode ? <PixelCanvas /> : <ModePane mode={mode} />}
      </main>
      <aside className="desktop__right">
        {mode === 'draw' && <PalettePanel />}
        {(mode === 'draw' || mode === 'rig') && <PartList />}
        <ModePane mode={mode} side />
      </aside>
      <footer className="desktop__bottom">
        <ModePane mode={mode} bottom />
      </footer>
    </div>
  )
}
