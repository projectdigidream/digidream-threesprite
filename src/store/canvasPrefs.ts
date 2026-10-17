/**
 * How the drawing canvas looks on this device: what the art is drawn over,
 * and whether Animate draws the bones over it. Not part of the sprite.
 */
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export type CanvasBackground = 'dark' | 'light' | 'grey' | 'white' | 'black'

/** Two tones each: a checkerboard, or one colour when they are the same. */
export const BACKGROUNDS: { id: CanvasBackground; label: string; a: string; b: string }[] = [
  { id: 'dark', label: 'Dark checks', a: '#2a3040', b: '#343b4d' },
  { id: 'light', label: 'Light checks', a: '#c9ccd3', b: '#e6e8ec' },
  { id: 'grey', label: 'Grey', a: '#7c8089', b: '#7c8089' },
  { id: 'white', label: 'White', a: '#ffffff', b: '#ffffff' },
  { id: 'black', label: 'Black', a: '#000000', b: '#000000' },
]

export const backgroundOf = (id: CanvasBackground) => BACKGROUNDS.find(b => b.id === id) ?? BACKGROUNDS[0]

const KEY = 'threesprite.canvas'

interface Saved { background: CanvasBackground; bones: boolean }

function read(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>
    return { background: BACKGROUNDS.some(b => b.id === v.background) ? v.background! : 'dark', bones: v.bones !== false }
  } catch {
    return { background: 'dark', bones: true }
  }
}

export interface CanvasPrefs extends Saved {
  setBackground: (b: CanvasBackground) => void
  setBones: (on: boolean) => void
}

export const canvasPrefs = createStore<CanvasPrefs>()((set, get) => {
  const save = (patch: Partial<Saved>) => {
    set(patch)
    const { background, bones } = get()
    try { localStorage.setItem(KEY, JSON.stringify({ background, bones })) } catch { /* kept for this session */ }
  }
  return {
    ...read(),
    setBackground: background => save({ background }),
    setBones: bones => save({ bones }),
  }
})

export function useCanvasPrefs<T>(selector: (p: CanvasPrefs) => T): T {
  return useStore(canvasPrefs, selector)
}

/** A CSS background showing a choice: its checkerboard or its colour. */
export function swatchStyle(id: CanvasBackground): { background: string } {
  const { a, b } = backgroundOf(id)
  return { background: a === b ? a : `repeating-conic-gradient(${b} 0 25%, ${a} 0 50%) 0 0 / 10px 10px` }
}
