import { useEditor } from '../../store/editorStore'
import PixelCanvas from '../canvas/PixelCanvas'
import PalettePanel from '../panels/PalettePanel'
import PartList from '../panels/PartList'
import SolidsPanel from '../panels/SolidsPanel'
import ToolPanel from '../panels/ToolPanel'
import ViewStrip from '../panels/ViewStrip'
import Preview3D from '../preview/Preview3D'
import ViewGrid from '../preview/ViewGrid'
import ModePane from './ModePane'

export default function DesktopLayout() {
  const mode = useEditor(s => s.ui.mode)
  const canvasMode = mode === 'draw' || mode === 'rig' || mode === 'animate'

  if (mode === 'preview') {
    // Studio: 3D in the centre, every authored view drawable beside it.
    return (
      <div className="desktop desktop--preview">
        <aside className="desktop__left"><ToolPanel /></aside>
        <main className="desktop__center"><Preview3D /></main>
        <aside className="desktop__right desktop__right--wide">
          <PalettePanel />
          <SolidsPanel compact />
          <ViewGrid columns={2} />
        </aside>
        <footer className="desktop__bottom" />
      </div>
    )
  }

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
        {mode === 'draw' && <PartList />}
        {mode === 'draw' && <SolidsPanel />}
        <ModePane mode={mode} side />
        {mode === 'rig' && <PartList />}
      </aside>
      <footer className="desktop__bottom">
        <ModePane mode={mode} bottom />
      </footer>
    </div>
  )
}
