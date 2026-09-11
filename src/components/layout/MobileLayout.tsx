import { useEditor } from '../../store/editorStore'
import PixelCanvas from '../canvas/PixelCanvas'
import PalettePanel from '../panels/PalettePanel'
import PartList from '../panels/PartList'
import ToolPanel from '../panels/ToolPanel'
import ViewStrip from '../panels/ViewStrip'
import ModePane from './ModePane'
import TabBar from './TabBar'

export default function MobileLayout() {
  const mode = useEditor(s => s.ui.mode)
  const canvasMode = mode === 'draw' || mode === 'rig' || mode === 'animate'
  return (
    <div className={`mobile mobile--${mode}`}>
      {canvasMode && <ViewStrip />}
      <div className="mobile__main">
        {canvasMode ? <PixelCanvas /> : <ModePane mode={mode} />}
      </div>
      {mode === 'draw' && (
        <div className="mobile__strips">
          <ToolPanel horizontal />
          <PalettePanel compact />
        </div>
      )}
      {mode === 'rig' && <div className="mobile__sheet"><PartList /><ModePane mode={mode} side /></div>}
      {mode === 'animate' && <div className="mobile__sheet"><ModePane mode={mode} bottom /></div>}
      {mode === 'preview' && <div className="mobile__sheet"><ModePane mode={mode} side /></div>}
      <TabBar bottom />
    </div>
  )
}
