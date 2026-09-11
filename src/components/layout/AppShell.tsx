import { useEffect, useState } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useEditor } from '../../store/editorStore'
import { startPlaybackLoop } from '../../store/playback'
import NewProjectDialog from '../project/NewProjectDialog'
import ProjectSettingsDialog from '../project/ProjectSettingsDialog'
import DesktopLayout from './DesktopLayout'
import MobileLayout from './MobileLayout'
import Toolbar from './Toolbar'

export default function AppShell() {
  const mobile = useIsMobile()
  const [dialog, setDialog] = useState<'new' | 'settings' | null>(null)
  const name = useEditor(s => s.doc.name)
  const dirty = useEditor(s => s.dirty)
  useKeyboardShortcuts()

  useEffect(() => { document.title = `${dirty ? '• ' : ''}${name} — ThreeSprite` }, [name, dirty])
  useEffect(() => startPlaybackLoop(), [])

  return (
    <div className={`app ${mobile ? 'app--mobile' : 'app--desktop'}`}>
      <Toolbar compact={mobile} onNew={() => setDialog('new')} onSettings={() => setDialog('settings')} />
      {mobile ? <MobileLayout /> : <DesktopLayout />}
      {dialog === 'new' && <NewProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <ProjectSettingsDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
