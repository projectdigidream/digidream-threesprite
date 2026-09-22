/**
 * The GIF encoder, checked by decoding its output back to pixels. A decoder
 * written here rather than pulled in keeps the test honest: it reads the bytes
 * the way any viewer would, so an encoder that only makes sense to itself fails.
 */
import { describe, it, expect } from 'vitest'
import { delayForFps, encodeGif } from '../../core/export/gifBuild'

interface DecodedFrame { delay: number; transparent: number | null; pixels: Uint8ClampedArray }
interface DecodedGif { width: number; height: number; loops: boolean; frames: DecodedFrame[] }

function decodeGif(bytes: Uint8Array): DecodedGif {
  let p = 0
  const u8 = () => bytes[p++]
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v }
  const header = String.fromCharCode(...bytes.subarray(0, 6))
  if (header !== 'GIF89a') throw new Error(`bad header ${header}`)
  p = 6
  const width = u16()
  const height = u16()
  const packed = u8()
  u8() // background index
  u8() // aspect
  let table = new Uint8Array(0)
  if (packed & 0x80) {
    const size = 1 << ((packed & 7) + 1)
    table = bytes.subarray(p, p + size * 3)
    p += size * 3
  }

  const readBlocks = (): Uint8Array => {
    const parts: Uint8Array[] = []
    for (;;) {
      const len = u8()
      if (len === 0) break
      parts.push(bytes.subarray(p, p + len))
      p += len
    }
    const total = parts.reduce((a, b) => a + b.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const part of parts) { out.set(part, at); at += part.length }
    return out
  }

  const frames: DecodedFrame[] = []
  let loops = false
  let delay = 0
  let transparent: number | null = null

  for (;;) {
    const block = u8()
    if (block === 0x3b) break
    if (block === 0x21) {
      const label = u8()
      if (label === 0xf9) {
        u8() // block size
        const flags = u8()
        delay = u16()
        const tIndex = u8()
        transparent = flags & 1 ? tIndex : null
        u8() // terminator
      } else if (label === 0xff) {
        const len = u8()
        const name = String.fromCharCode(...bytes.subarray(p, p + len))
        p += len
        readBlocks()
        if (name === 'NETSCAPE2.0') loops = true
      } else {
        u8()
        readBlocks()
      }
      continue
    }
    if (block !== 0x2c) throw new Error(`unexpected block 0x${block.toString(16)}`)
    u16(); u16() // left, top
    const fw = u16()
    const fh = u16()
    const lpacked = u8()
    if (lpacked & 0x80) throw new Error('local colour tables are not produced')
    const minCodeSize = u8()
    const data = readBlocks()

    // variable-width LZW, least significant bit first
    const clear = 1 << minCodeSize
    const end = clear + 1
    let codeSize = minCodeSize + 1
    let dict: number[][] = []
    const resetDict = () => {
      dict = []
      for (let i = 0; i < clear; i++) dict.push([i])
      dict.push([], [])
      codeSize = minCodeSize + 1
    }
    resetDict()
    const out: number[] = []
    let bit = 0
    let prev: number[] | null = null
    const nextCode = (): number | null => {
      let code = 0
      for (let i = 0; i < codeSize; i++) {
        const byteAt = bit >> 3
        if (byteAt >= data.length) return null
        code |= ((data[byteAt] >> (bit & 7)) & 1) << i
        bit++
      }
      return code
    }
    for (;;) {
      const code = nextCode()
      if (code === null || code === end) break
      if (code === clear) { resetDict(); prev = null; continue }
      let entry: number[]
      if (code < dict.length && dict[code].length) entry = dict[code]
      else if (prev) entry = [...prev, prev[0]]
      else throw new Error('bad LZW stream')
      out.push(...entry)
      if (prev) {
        dict.push([...prev, entry[0]])
        if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++
      }
      prev = entry
    }

    const pixels = new Uint8ClampedArray(fw * fh * 4)
    for (let i = 0; i < fw * fh; i++) {
      const idx = out[i] ?? 0
      if (transparent !== null && idx === transparent) continue
      pixels[i * 4] = table[idx * 3]
      pixels[i * 4 + 1] = table[idx * 3 + 1]
      pixels[i * 4 + 2] = table[idx * 3 + 2]
      pixels[i * 4 + 3] = 255
    }
    frames.push({ delay, transparent, pixels })
  }
  return { width, height, loops, frames }
}

/** RGBA from a list of [r,g,b,a] quads. */
const rgba = (...px: number[][]) => Uint8ClampedArray.from(px.flat())

describe('GIF encoding', () => {
  it('round-trips pixel art exactly, transparency included', () => {
    const f0 = rgba([255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 0, 0], [0, 0, 255, 255])
    const f1 = rgba([0, 255, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 0, 0])
    const { bytes, warnings } = encodeGif([f0, f1], 2, 2, { delaysCs: [12], repeat: true })
    expect(warnings).toEqual([])

    const g = decodeGif(bytes)
    expect({ w: g.width, h: g.height, loops: g.loops, count: g.frames.length }).toEqual({ w: 2, h: 2, loops: true, count: 2 })
    expect(g.frames[0].delay).toBe(12)
    expect(g.frames[1].delay).toBe(12)
    expect(Array.from(g.frames[0].pixels)).toEqual(Array.from(f0))
    expect(Array.from(g.frames[1].pixels)).toEqual(Array.from(f1))
    expect(g.frames[0].transparent).toBe(0)
  })

  it('keeps every colour of a full palette', () => {
    // 255 distinct colours is the most an exact palette holds beside transparency
    const px: number[][] = []
    for (let i = 0; i < 255; i++) px.push([i, (i * 7) & 255, (i * 13) & 255, 255])
    const frame = rgba(...px)
    const { bytes, warnings } = encodeGif([frame], 255, 1, { delaysCs: [10], repeat: false })
    expect(warnings).toEqual([])
    const g = decodeGif(bytes)
    expect(Array.from(g.frames[0].pixels)).toEqual(Array.from(frame))
    expect(g.loops).toBe(false)
  })

  it('quantises beyond 255 colours and stays close', () => {
    const px: number[][] = []
    for (let i = 0; i < 600; i++) px.push([i & 255, (i >> 1) & 255, (i * 3) & 255, 255])
    const frame = rgba(...px)
    const { bytes, warnings } = encodeGif([frame], 600, 1, { delaysCs: [10], repeat: false })
    expect(warnings).toEqual(['GIF has more than 255 colours; frames were quantised'])
    const g = decodeGif(bytes)
    expect(g.frames[0].pixels.length).toBe(frame.length)
    // every pixel is opaque and near the colour asked for
    let worst = 0
    for (let i = 0; i < frame.length; i += 4) {
      expect(g.frames[0].pixels[i + 3]).toBe(255)
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(g.frames[0].pixels[i + c] - frame[i + c]))
    }
    expect(worst, `worst channel error ${worst}`).toBeLessThan(40)
  })

  it('treats half-transparent pixels as the preview does', () => {
    const frame = rgba([10, 20, 30, 127], [10, 20, 30, 128])
    const g = decodeGif(encodeGif([frame], 2, 1, { delaysCs: [10], repeat: false }).bytes)
    expect(g.frames[0].pixels[3]).toBe(0)
    expect(Array.from(g.frames[0].pixels.subarray(4))).toEqual([10, 20, 30, 255])
  })

  it('repeats the last delay when the list is short, and survives a long frame', () => {
    const big = new Uint8ClampedArray(64 * 64 * 4)
    for (let i = 0; i < big.length; i += 4) { big[i] = i % 251; big[i + 3] = 255 }
    const g = decodeGif(encodeGif([big, big], 64, 64, { delaysCs: [7], repeat: true }).bytes)
    expect(g.frames.map(f => f.delay)).toEqual([7, 7])
    // 251 distinct reds still fit an exact palette, so this is lossless
    expect(Array.from(g.frames[0].pixels)).toEqual(Array.from(big))
  })

  it('refuses nothing to encode', () => {
    expect(() => encodeGif([], 1, 1, { delaysCs: [10], repeat: false })).toThrow(/no frames/)
  })

  it('converts frame rates to centiseconds the way Rust does', () => {
    const w: string[] = []
    expect(delayForFps(8, w, 'x')).toBe(13) // 12.5 rounds away from zero
    expect(w).toHaveLength(1)
    expect(delayForFps(10, w, 'x')).toBe(10)
    expect(delayForFps(0, w, 'x')).toBe(100)
    expect(w).toHaveLength(1)
  })
})
