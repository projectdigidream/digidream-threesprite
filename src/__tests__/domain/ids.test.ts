import { describe, it, expect } from 'vitest'
import { ID_RE, newId } from '../../domain/ids'

describe('newId', () => {
  it('always yields 12 safe characters and never leaks "undefined"', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      const id = newId()
      expect(id).toHaveLength(12)
      expect(id).toMatch(ID_RE)
      expect(id).not.toContain('undefined')
      seen.add(id)
    }
    expect(seen.size).toBe(5000)
    expect(newId(20)).toHaveLength(20)
  })
})
