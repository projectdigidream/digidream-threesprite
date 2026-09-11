import { useEffect } from 'react'
import { isAndroid } from '../core/platform'
import { editorStore } from '../store/editorStore'

/**
 * Android's back gesture pops browser history; without an entry it closes the
 * activity. Keep one entry parked so back first closes an open dialog, then
 * returns to the Draw tab, instead of leaving the app.
 */
export function useAndroidBack(closeDialog: () => boolean): void {
  useEffect(() => {
    if (!isAndroid()) return
    history.pushState({ threesprite: 1 }, '')
    const onPop = () => {
      const handled = closeDialog()
      if (!handled) {
        const s = editorStore.getState()
        if (s.ui.mode !== 'draw') s.setUi({ mode: 'draw', playing: false })
      }
      history.pushState({ threesprite: 1 }, '')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [closeDialog])
}
