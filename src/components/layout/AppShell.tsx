import { useCallback, useEffect, useRef, useState } from 'react'
import { getLibrary } from '../../core/io/library'
import { openRecent } from '../../core/io/projectActions'
import { startVscodeBridge } from '../../core/io/vscodeHost'
import { isVscode } from '../../core/platform'
import { useAndroidBack } from '../../hooks/useAndroidBack'
import { useAutosave } from '../../hooks/useAutosave'
import { useIsMobile } from '../../hooks/useIsMobile'
import { isTypingTarget, useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { editorStore, useEditor } from '../../store/editorStore'
import { startPlaybackLoop } from '../../store/playback'
import HelpDialog from '../project/HelpDialog'
import NewProjectDialog from '../project/NewProjectDialog'
import ProjectMenu, { useFileShortcuts } from '../project/ProjectMenu'
import ProjectSettingsDialog from '../project/ProjectSettingsDialog'
import DialogHost from '../ui/DialogHost'
import DesktopLayout from './DesktopLayout'
import MobileLayout from './MobileLayout'
import Toolbar from './Toolbar'

type Toast = { msg: string; kind: 'info' | 'error'; id: number }
type Dialog = 'new' | 'settings' | 'menu' | 'help' | null

export default function AppShell() {
  const mobile = useIsMobile()
  const [dialog, setDialog] = useState<Dialog>(null)
  const dialogRef = useRef<Dialog>(null)
  dialogRef.current = dialog
  const [toast, setToast] = useState<Toast | null>(null)
  /** Name offered by the new-project dialog when a host opened an empty file. */
  const [newName, setNewName] = useState<string | undefined>()
  const name = useEditor(s => s.doc.name)
  const dirty = useEditor(s => s.dirty)
  useKeyboardShortcuts()
  useAutosave()

  const notify = useCallback((msg: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now()
    setToast({ msg, kind, id })
    window.setTimeout(() => setToast(t => (t?.id === id ? null : t)), kind === 'error' ? 6000 : 2500)
  }, [])
  const openNew = useCallback(() => setDialog('new'), [])
  useFileShortcuts(openNew, notify)
  useAndroidBack(useCallback(() => { if (dialogRef.current) { setDialog(null); return true } return false }, []))

  useEffect(() => { document.title = `${dirty ? '• ' : ''}${name} — PrSpr editor` }, [name, dirty])
  useEffect(() => startPlaybackLoop(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey) return
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); setDialog(d => (d === 'help' ? null : 'help')) }
      if (e.key === 'Escape') setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Inside VS Code the host sends the file it wants opened; nothing is restored here.
  // An empty file is a new sprite: ask for its canvas and views, which are fixed once made.
  const onEmptyFile = useCallback((name: string) => { setNewName(name); setDialog('new') }, [])
  useEffect(() => startVscodeBridge(notify, onEmptyFile), [notify, onEmptyFile])

  // On launch, continue with the most recent project when the fresh document is untouched.
  useEffect(() => {
    if (isVscode()) return
    let cancelled = false
    ;(async () => {
      try {
        const recent = await getLibrary().list()
        if (cancelled || recent.length === 0) return
        const s = editorStore.getState()
        if (s.dirty || s.history.undo.length) return
        const res = await openRecent(recent[0])
        if (res.warnings.length) notify(res.warnings.join('\n'))
      } catch (e) {
        notify(`Could not reopen the last project: ${e instanceof Error ? e.message : String(e)}`, 'error')
      }
    })()
    return () => { cancelled = true }
  }, [notify])

  return (
    <div className={`app ${mobile ? 'app--mobile' : 'app--desktop'}`}>
      <Toolbar compact={mobile} onMenu={() => setDialog('menu')} onSettings={() => setDialog('settings')} onHelp={() => setDialog('help')} />
      {mobile ? <MobileLayout /> : <DesktopLayout />}
      {dialog === 'menu' && <ProjectMenu onNew={openNew} onClose={() => setDialog(null)} notify={notify} />}
      {dialog === 'new' && <NewProjectDialog defaultName={newName} onClose={() => { setDialog(null); setNewName(undefined) }} />}
      {dialog === 'settings' && <ProjectSettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      <DialogHost />
      {toast && <div className={`toast toast--${toast.kind}`} role="status">{toast.msg}</div>}
    </div>
  )
}
