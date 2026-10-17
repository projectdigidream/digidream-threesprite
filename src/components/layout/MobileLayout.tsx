import { useState } from 'react'
import { useLandscape } from '../../hooks/useIsMobile'
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
  // Held sideways, the rail has room under the tools and colours for a panel
  // at all times: the two buttons switch it between Parts and Solids instead
  // of opening and closing a sheet over the canvas. Kept apart from the sheet,
  // so picking a tab there does not open one over the 3D view's canvas.
  const [railTab, setRailTab] = useState<Exclude<Sheet, null>>('parts')
  const landscape = useLandscape()
  const railSheet = landscape && mode === 'draw'
  const shown: Sheet = railSheet ? railTab : sheet
  const pick = (which: Exclude<Sheet, null>) => (railSheet ? setRailTab(which) : setSheet(s => (s === which ? null : which)))

  const toggles = (
    <>
      <button className={`icon-btn ${shown === 'parts' ? 'is-active' : ''}`} title="Parts" onClick={() => pick('parts')}><Icon name="layers" /></button>
      <button className={`icon-btn ${shown === 'solids' ? 'is-active' : ''}`} title="Solids" onClick={() => pick('solids')}><Icon name="cube" /></button>
    </>
  )
  const strips = (
    <div className="mobile__strips">
      <div className="mobile__strip-row">
        <ToolPanel horizontal />
        {!railSheet && toggles}
      </div>
      <PalettePanel compact />
      {railSheet && <div className="mobile__sheet-switch">{toggles}</div>}
    </div>
  )
  const sheetPane = shown && (
    <div className="mobile__sheet">
      {shown === 'parts' ? <PartList /> : <SolidsPanel compact />}
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
        {!landscape && <TabBar bottom />}
      </div>
    )
  }

  // One tree for both orientations: in portrait the three wrappers are
  // `display: contents`, so everything stacks under the canvas exactly as it
  // always did; in landscape the body turns into a row and the rail becomes a
  // column of panels down the right-hand side.
  return (
    <div className={`mobile mobile--${mode}`}>
      <div className="mobile__body">
        <div className="mobile__col">
          {canvasMode && <ViewStrip />}
          <div className="mobile__main">
            {canvasMode ? <PixelCanvas /> : <ModePane mode={mode} />}
          </div>
        </div>
        <div className="mobile__rail">
          {mode === 'draw' && sheetPane}
          {mode === 'draw' && strips}
          {mode === 'rig' && <div className="mobile__sheet"><ModePane mode={mode} side /><PartList /></div>}
          {mode === 'animate' && <div className="mobile__sheet"><ModePane mode={mode} bottom /><ModePane mode={mode} side /></div>}
        </div>
      </div>
      {!landscape && <TabBar bottom />}
    </div>
  )
}
