import { describe, it, expect } from 'vitest'
import { canvasPrefs, swatchStyle } from '../../store/canvasPrefs'

describe('canvas preferences', () => {
  it('keep the background and the bones choice on this device', () => {
    canvasPrefs.getState().setBackground('grey')
    canvasPrefs.getState().setBones(false)
    expect(JSON.parse(localStorage.getItem('threesprite.canvas')!)).toEqual({ background: 'grey', bones: false })
    expect(canvasPrefs.getState().background).toBe('grey')
  })

  it('draw checks as checks and a colour as itself', () => {
    expect(swatchStyle('white').background).toBe('#ffffff')
    expect(swatchStyle('dark').background).toMatch(/^repeating-conic-gradient\(/)
  })
})
