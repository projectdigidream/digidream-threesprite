import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import NewProjectDialog from '../../components/project/NewProjectDialog'
import { editorStore } from '../../store/editorStore'

// React reads a controlled input's value through the prototype's setter.
const type = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

let root: Root | null = null
let host: HTMLElement | null = null
const open = (defaultName?: string) => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<NewProjectDialog defaultName={defaultName} onClose={() => {}} />))
  const [name, id] = [...host.querySelectorAll('input')] as HTMLInputElement[]
  return { name, id }
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null })

describe('the new-sprite form', () => {
  it('gives the sprite id the name as it is typed, so new sprites do not all export as SPRT', () => {
    const { name, id } = open()
    expect(id.value).toBe('SPRT')
    act(() => type(name, 'Imp boss'))
    expect(id.value).toBe('Impboss')
  })

  it('keeps an id typed by hand when the name changes after', () => {
    const { name, id } = open()
    act(() => type(id, 'TROO'))
    act(() => type(name, 'Imp'))
    expect(id.value).toBe('TROO')
  })

  it('starts from the name a host gives, and creates the project under it', async () => {
    const { name, id } = open('cacodemon')
    expect(id.value).toBe('cacodemon')
    act(() => type(name, 'Caco'))
    expect(id.value).toBe('Caco')
    const create = [...host!.querySelectorAll('button')].find(b => /create/i.test(b.textContent ?? ''))!
    await act(async () => { create.click() })
    expect(editorStore.getState().doc.spriteName).toBe('Caco')
  })
})
