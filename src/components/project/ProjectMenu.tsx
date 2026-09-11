import { useEffect, useState } from 'react'
import { getLibrary, type RecentEntry } from '../../core/io/library'
import { importPngAsPart, openProjectFromDisk, openRecent, removeFromLibrary, saveProject, saveProjectAs } from '../../core/io/projectActions'
import { isTauri } from '../../core/platform'
import { isTypingTarget } from '../../hooks/useKeyboardShortcuts'
import { useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

interface Props {
  onNew: () => void
  onClose: () => void
  notify: (msg: string, kind?: 'info' | 'error') => void
}

/** The file menu: new / open / save / save as / import PNG / recent projects. */
export default function ProjectMenu({ onNew, onClose, notify }: Props) {
  const dirty = useEditor(s => s.dirty)
  const source = useEditor(s => s.source)
  const docId = useEditor(s => s.doc.id)
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const tauri = isTauri()

  useEffect(() => { getLibrary().list().then(setRecent).catch(() => setRecent([])) }, [])

  const guard = () => !dirty || window.confirm('Discard unsaved changes in the current project?')

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      const r = await fn()
      if (r !== null && done) notify(done)
      onClose()
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  return (
    <div className="menu-backdrop" onClick={onClose}>
      <div className="menu" onClick={e => e.stopPropagation()} role="menu">
        <button className="menu__item" onClick={() => { onClose(); onNew() }}><Icon name="new" size={16} /> New project… <kbd>Ctrl N</kbd></button>
        <button className="menu__item" onClick={() => { if (guard()) run(openProjectFromDisk) }}><Icon name="folder" size={16} /> Open… <kbd>Ctrl O</kbd></button>
        <button className="menu__item" onClick={() => run(saveProject, 'Saved')}><Icon name="save" size={16} /> Save <kbd>Ctrl S</kbd></button>
        <button className="menu__item" onClick={() => run(saveProjectAs, 'Saved')}><Icon name="export" size={16} /> {tauri ? 'Save as…' : 'Download project…'}</button>
        <button className="menu__item" onClick={() => run(importPngAsPart, 'Imported as a new part')}><Icon name="layers" size={16} /> Import PNG as part…</button>
        <div className="menu__meta">{source.path ? source.path : 'Stored in the app library'}</div>
        {recent.length > 0 && (
          <>
            <div className="menu__header">Recent</div>
            <div className="menu__recent">
              {recent.map(r => (
                <div key={r.id} className={`menu__recent-row ${r.id === docId ? 'is-current' : ''}`}>
                  <button className="menu__recent-open" onClick={() => { if (r.id === docId) { onClose(); return } if (guard()) run(() => openRecent(r).then(res => { if (res.warnings.length) notify(res.warnings.join('\n')); return res })) }}>
                    {r.thumb ? <img src={r.thumb} alt="" className="menu__thumb" /> : <span className="menu__thumb" />}
                    <span className="menu__recent-name">{r.name}</span>
                    <span className="menu__recent-date">{new Date(r.modifiedAt).toLocaleDateString()}</span>
                  </button>
                  <button className="icon-btn" title="Remove from library" onClick={async () => { if (window.confirm(`Remove "${r.name}" from the library?`)) { await removeFromLibrary(r.id); setRecent(await getLibrary().list()) } }}><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Global file shortcuts. */
export function useFileShortcuts(onNew: () => void, notify: (msg: string, kind?: 'info' | 'error') => void): void {
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      try {
        if (k === 's') { e.preventDefault(); if (e.shiftKey) await saveProjectAs(); else { await saveProject(); notify('Saved') } }
        else if (k === 'o') { e.preventDefault(); await openProjectFromDisk() }
        else if (k === 'n') { e.preventDefault(); onNew() }
      } catch (err) {
        notify(err instanceof Error ? err.message : String(err), 'error')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNew, notify])
}
