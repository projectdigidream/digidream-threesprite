import { describe, it, expect } from 'vitest'
import { isTauri, isWeb } from '../../core/platform'

describe('platform', () => {
  it('reports web when the Tauri bridge is absent', () => {
    expect(isTauri()).toBe(false)
    expect(isWeb()).toBe(true)
  })
})
