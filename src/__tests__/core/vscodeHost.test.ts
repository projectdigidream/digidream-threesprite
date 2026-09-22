import { describe, it, expect } from 'vitest'
import { base64ToBytes, bytesToBase64, projectNameFromPath } from '../../core/io/vscodeHost'

describe('vscode host bridge helpers', () => {
  it('names a new project after its file', () => {
    expect(projectNameFromPath('/Users/me/sprites/hero.tsprite')).toBe('hero')
    expect(projectNameFromPath('C:\\sprites\\Big Boss.TSPRITE')).toBe('Big Boss')
    expect(projectNameFromPath('untitled:sprite.tsprite')).toBe('untitled:sprite')
    expect(projectNameFromPath('/x/.tsprite')).toBe('New sprite')
    expect(projectNameFromPath(undefined)).toBe('New sprite')
  })

  it('base64 round-trips bytes, including sizes past the chunk boundary', () => {
    for (const n of [0, 1, 3, 0x8000, 0x8000 + 7, 100_000]) {
      const bytes = new Uint8Array(n)
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 255
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
    }
  })
})
