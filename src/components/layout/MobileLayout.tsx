import { useState } from 'react'
import { useEditor } from '../../store/editorStore'
import PixelCanvas from '../canvas/PixelCanvas'
import PalettePanel from '../panels/PalettePanel'
import PartList from '../panels/PartList'
import SolidsPanel from '../panels/SolidsPanel'
import ToolPanel from '../panels/ToolPanel'
import ViewStrip from '../panels/ViewStrip'
import Preview3D from '../preview/Preview3D'
import { Icon } from '../ui/Icon'
import ModePane from './ModePane'
import TabBar from './TabBar'

type Sheet = 'parts' | 'solids' | null

export default function MobileLayout() {
  const mode = useEditor(s => s.ui.mode)
  const canvasMode = mode === 'draw' || mode === 'rig' || mode === 'animate'
  const [sheet, setSheet] = useState<Sheet>(null)

  const strips = (
    <div className="mobile__strips">
      <div className="mobile__strip-row">
        <ToolPanel horizontal />
        <button className={`icon-btn ${sheet === 'parts' ? 'is-active' : ''}`} title="Parts" onClick={() => setSheet(s => (s === 'parts' ? null : 'parts'))}><Icon name="layers" /></button>
        <button className={`icon-btn ${sheet === 'solids' ? 'is-active' : ''}`} title="Solids" onClick={() => setSheet(s => (s === 'solids' ? null : 'solids'))}><Icon name="cube" /></button>
      </div>
      <PalettePanel compact />
    </div>
  )
  const sheetPane = sheet && (
    <div className="mobile__sheet">
      {sheet === 'parts' ? <PartList /> : <SolidsPanel compact />}
    </div>
  )

  if (mode === 'preview') {
    // Studio: 3D on top and the drawing canvas below in portrait; side by side in landscape (CSS).
    return (
      <div className="mobile mobile--preview">
        <div className="studio-mobile">
          <div className="studio-mobile__3d"><Preview3D /></div>
          <div className="studio-mobile__2d">
            <ViewStrip />
            <PixelCanvas />
            {sheetPane}
            {strips}
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
      {mode === 'draw' && sheetPane}
      {mode === 'draw' && strips}
      {mode === 'rig' && <div className="mobile__sheet"><ModePane mode={mode} side /><PartList /></div>}
      {mode === 'animate' && <div className="mobile__sheet"><ModePane mode={mode} bottom /><ModePane mode={mode} side /></div>}
      <TabBar bottom />
    </div>
  )
}
