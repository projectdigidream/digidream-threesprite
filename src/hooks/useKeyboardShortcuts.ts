import { useEffect } from 'react'
import { editorStore, type ToolId } from '../store/editorStore'

const TOOL_KEYS: Record<string, ToolId> = { b: 'pencil', e: 'eraser', g: 'fill', i: 'eyedropper', m: 'select', v: 'move', h: 'hand' }

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

/** Global editor shortcuts (desktop). Canvas-local keys (zoom, delete selection) live in the canvas. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const s = editorStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && k === 'y') { e.preventDefault(); s.redo(); return }
      if (mod) return
      if (k in TOOL_KEYS && s.ui.mode === 'draw') { s.setUi({ tool: TOOL_KEYS[k] }); return }
      if (k === 'x') { s.setUi(ui => ({ primary: ui.secondary, secondary: ui.primary })); return }
      if (k === '[' || k === ']') {
        const anim = s.ui.animId ? s.doc.animations[s.ui.animId] : null
        if (!anim) return
        const d = k === '[' ? -1 : 1
        s.setUi(ui => ({ frame: (ui.frame + d + anim.frameCount) % anim.frameCount }))
        return
      }
      if (k === ',' || k === '.') {
        const N = s.doc.views.count
        const d = k === ',' ? -1 : 1
        s.setUi(ui => ({ view: ((ui.view - 1 + d + N) % N) + 1 }))
        return
      }
      if (k === ' ' && (s.ui.mode === 'animate' || s.ui.mode === 'preview')) {
        e.preventDefault()
        s.setUi(ui => ({ playing: !ui.playing }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
