import { useEditor } from '../../store/editorStore'
import PixelCanvas from '../canvas/PixelCanvas'
import PalettePanel from '../panels/PalettePanel'
import PartList from '../panels/PartList'
import ToolPanel from '../panels/ToolPanel'
import ViewStrip from '../panels/ViewStrip'
import Preview3D from '../preview/Preview3D'
import ModePane from './ModePane'
import TabBar from './TabBar'

export default function MobileLayout() {
  const mode = useEditor(s => s.ui.mode)
  const canvasMode = mode === 'draw' || mode === 'rig' || mode === 'animate'

  if (mode === 'preview') {
    // Studio: 3D on top and the drawing canvas below in portrait; side by side in landscape (CSS).
    return (
      <div className="mobile mobile--preview">
        <div className="studio-mobile">
          <div className="studio-mobile__3d"><Preview3D /></div>
          <div className="studio-mobile__2d">
            <ViewStrip />
            <PixelCanvas />
            <div className="mobile__strips">
              <ToolPanel horizontal />
              <PalettePanel compact />
            </div>
          </div>
        </div>
        <TabBar bottom />
      </div>
    )
  }

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
      {mode === 'rig' && <div className="mobile__sheet"><ModePane mode={mode} side /><PartList /></div>}
      {mode === 'animate' && <div className="mobile__sheet"><ModePane mode={mode} bottom /><ModePane mode={mode} side /></div>}
      <TabBar bottom />
    </div>
  )
}
