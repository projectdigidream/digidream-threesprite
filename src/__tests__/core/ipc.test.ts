import { describe, it, expect } from 'vitest'
import { base64ToBytes, bytesToBase64 } from '../../core/io/ipc'

describe('ipc base64 transport', () => {
  it('round-trips arbitrary bytes, including chunk boundaries', () => {
    const n = 0x8000 * 3 + 17
    const bytes = new Uint8Array(n)
    for (let i = 0; i < n; i++) bytes[i] = (i * 131 + (i >> 9)) & 0xff
    const b64 = bytesToBase64(bytes)
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    const back = base64ToBytes(b64)
    expect(back.length).toBe(n)
    expect(Array.from(back.subarray(0x7ffe, 0x8003))).toEqual(Array.from(bytes.subarray(0x7ffe, 0x8003)))
    expect(back).toEqual(bytes)
  })

  it('handles the empty payload', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(base64ToBytes('').length).toBe(0)
  })
})
