import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import ExportPanel from '../../components/export/ExportPanel'
import { createProject } from '../../domain/project'
import { editorStore } from '../../store/editorStore'

let root: Root | null = null
let host: HTMLElement | null = null
const open = (spriteName: string) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  editorStore.getState().loadProject(createProject({ name: spriteName, spriteName, viewCount: 8 }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<ExportPanel />))
  return host
}
const active = (h: HTMLElement) => h.querySelector('.export__format.is-active b')?.textContent
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); root = null; host = null
  delete (window as { acquireVsCodeApi?: unknown }).acquireVsCodeApi
})

describe('the Export tab', () => {
  it('opens on Doom-style PNGs for a sprite that fits them', () => {
    expect(active(open('TROO'))).toBe('Doom-style PNGs')
  })

  it('opens on the atlas for one that does not, so it does not greet it with an error', () => {
    const h = open('WRAITH')
    expect(active(h)).toBe('Atlas + JSON')
    expect(h.querySelector('.warning')).toBeNull()
  })

  it("names the format it cannot do, when that one is picked", () => {
    const h = open('WRAITH')
    const doom = [...h.querySelectorAll('.export__format')].find(b => b.textContent?.includes('Doom-style')) as HTMLButtonElement
    act(() => doom.click())
    expect(h.querySelector('.warning b')?.textContent).toBe("Can't export as Doom-style PNGs:")
  })

  it('says inside the studio that the game needs nothing from it', () => {
    ;(window as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = () => ({})
    expect(open('WRAITH').querySelector('.export__hosted')?.textContent).toMatch(/game needs nothing from here/)
  })
})
