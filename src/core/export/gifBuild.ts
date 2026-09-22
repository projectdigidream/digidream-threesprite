/**
 * Animated GIF from RGBA frames, with no dependencies.
 *
 * Pixel art almost always fits an exact palette, so the common path collects
 * every colour used, puts transparency at index 0 and indexes each frame
 * directly. More than 255 colours falls back to median-cut quantisation, as the
 * Rust encoder falls back to NeuQuant. Both produce GIF89a with per-frame
 * delays in centiseconds, background disposal and an infinite loop when asked.
 *
 * Mirrors `src-tauri/src/gif_codec.rs` in behaviour; the byte stream differs
 * because the LZW coder is a different implementation, which the format allows.
 */

/** Alpha at or above this is opaque, matching the preview's alphaTest of 0.5. */
const ALPHA_CUTOFF = 128

export interface GifOptions {
  /** Per-frame delay in centiseconds; the last entry repeats if the list is short. */
  delaysCs: number[]
  repeat: boolean
}

export interface GifResult {
  bytes: Uint8Array
  warnings: string[]
}

/** Centiseconds per frame, warning when the rate is not representable. */
export function delayForFps(fps: number, warnings: string[], label: string): number {
  if (!(fps > 0)) return 100
  const exact = 100 / fps
  const d = Math.max(1, Math.round(exact))
  if (Math.abs(exact - d) > 1e-6) {
    warnings.push(`${label}: GIF timing is in 1/100 s steps, so ${fps} fps plays at ${(100 / d).toFixed(2)} fps`)
  }
  return d
}

class ByteWriter {
  private parts: number[] = []
  byte(v: number): void { this.parts.push(v & 0xff) }
  short(v: number): void { this.byte(v); this.byte(v >> 8) }
  bytes(v: ArrayLike<number>): void { for (let i = 0; i < v.length; i++) this.byte(v[i]) }
  ascii(s: string): void { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)) }
  toUint8Array(): Uint8Array { return new Uint8Array(this.parts) }
}

/** GIF's variable-width LZW, emitted as sub-blocks of at most 255 bytes. */
function lzwCompress(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let next = endCode + 1
  let dict = new Map<string, number>()

  const out: number[] = []
  let bitBuffer = 0
  let bitCount = 0
  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff)
      bitBuffer >>= 8
      bitCount -= 8
    }
  }
  const reset = () => {
    dict = new Map()
    codeSize = minCodeSize + 1
    next = endCode + 1
  }

  emit(clearCode)
  reset()

  let prefix = indices.length ? String(indices[0]) : ''
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const candidate = `${prefix},${k}`
    if (dict.has(candidate)) {
      prefix = candidate
      continue
    }
    emit(dict.get(prefix) ?? Number(prefix))
    if (next < 4096) {
      dict.set(candidate, next++)
      if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++
    } else {
      emit(clearCode)
      reset()
    }
    prefix = String(k)
  }
  if (prefix !== '') emit(dict.get(prefix) ?? Number(prefix))
  emit(endCode)
  if (bitCount > 0) out.push(bitBuffer & 0xff)
  return out
}

function writeSubBlocks(w: ByteWriter, data: number[]): void {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255)
    w.byte(chunk.length)
    w.bytes(chunk)
  }
  w.byte(0)
}

interface Indexed {
  palette: number[]
  /** One index per pixel, per frame. */
  frames: Uint8Array[]
  /** Index that reads as transparent, or -1 when the frames are fully opaque. */
  transparent: number
}

/** Exact palette: every distinct opaque colour, with index 0 kept for transparency. */
function indexExact(frames: Uint8ClampedArray[]): Indexed | null {
  const lookup = new Map<number, number>()
  const palette: number[] = [0, 0, 0]
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] < ALPHA_CUTOFF) continue
      const rgb = (f[i] << 16) | (f[i + 1] << 8) | f[i + 2]
      if (lookup.has(rgb)) continue
      if (lookup.size >= 255) return null
      lookup.set(rgb, lookup.size + 1)
      palette.push(f[i], f[i + 1], f[i + 2])
    }
  }
  const out = frames.map(f => {
    const idx = new Uint8Array(f.length / 4)
    for (let i = 0, p = 0; i < f.length; i += 4, p++) {
      idx[p] = f[i + 3] < ALPHA_CUTOFF ? 0 : (lookup.get((f[i] << 16) | (f[i + 1] << 8) | f[i + 2]) as number)
    }
    return idx
  })
  return { palette, frames: out, transparent: 0 }
}

/** Median cut over the opaque pixels, for artwork with more colours than a GIF holds. */
function indexQuantised(frames: Uint8ClampedArray[]): Indexed {
  const pixels: number[][] = []
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 4) {
      if (f[i + 3] >= ALPHA_CUTOFF) pixels.push([f[i], f[i + 1], f[i + 2]])
    }
  }
  let boxes: number[][][] = [pixels]
  while (boxes.length < 255 && boxes.some(b => b.length > 1)) {
    // split the box with the widest channel
    let bestIndex = -1
    let bestChannel = 0
    let bestSpread = -1
    boxes.forEach((box, bi) => {
      if (box.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (const p of box) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c] }
        if (hi - lo > bestSpread) { bestSpread = hi - lo; bestIndex = bi; bestChannel = c }
      }
    })
    if (bestIndex < 0 || bestSpread <= 0) break
    const box = boxes[bestIndex]
    box.sort((a, b) => a[bestChannel] - b[bestChannel])
    const mid = box.length >> 1
    boxes = [...boxes.slice(0, bestIndex), box.slice(0, mid), box.slice(mid), ...boxes.slice(bestIndex + 1)]
  }

  const palette: number[] = [0, 0, 0]
  const centres: number[][] = []
  for (const box of boxes) {
    if (box.length === 0) continue
    let r = 0, g = 0, b = 0
    for (const p of box) { r += p[0]; g += p[1]; b += p[2] }
    const c = [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)]
    centres.push(c)
    palette.push(c[0], c[1], c[2])
  }

  const nearest = new Map<number, number>()
  const pick = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b
    const hit = nearest.get(key)
    if (hit !== undefined) return hit
    let best = 1
    let bestD = Infinity
    for (let i = 0; i < centres.length; i++) {
      const c = centres[i]
      const d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2
      if (d < bestD) { bestD = d; best = i + 1 }
    }
    nearest.set(key, best)
    return best
  }

  const out = frames.map(f => {
    const idx = new Uint8Array(f.length / 4)
    for (let i = 0, p = 0; i < f.length; i += 4, p++) {
      idx[p] = f[i + 3] < ALPHA_CUTOFF ? 0 : pick(f[i], f[i + 1], f[i + 2])
    }
    return idx
  })
  return { palette, frames: out, transparent: 0 }
}

export function encodeGif(frames: Uint8ClampedArray[], width: number, height: number, opts: GifOptions): GifResult {
  if (frames.length === 0) throw new Error('gif: no frames')
  if (width > 0xffff || height > 0xffff) throw new Error('gif: frame too large')
  const warnings: string[] = []

  let indexed = indexExact(frames)
  if (!indexed) {
    warnings.push('GIF has more than 255 colours; frames were quantised')
    indexed = indexQuantised(frames)
  }

  // the colour table is padded to a power of two, at least two entries
  let tableSize = 2
  let bits = 1
  const used = indexed.palette.length / 3
  while (tableSize < used) { tableSize <<= 1; bits++ }
  const table = new Uint8Array(tableSize * 3)
  table.set(indexed.palette)

  const w = new ByteWriter()
  w.ascii('GIF89a')
  w.short(width)
  w.short(height)
  w.byte(0x80 | ((bits - 1) & 0x07)) // global table, 8-bit colour resolution
  w.byte(0) // background colour index
  w.byte(0) // square pixels
  w.bytes(table)

  if (opts.repeat) {
    w.byte(0x21); w.byte(0xff); w.byte(11)
    w.ascii('NETSCAPE2.0')
    w.byte(3); w.byte(1); w.short(0) // loop forever
    w.byte(0)
  }

  const minCodeSize = Math.max(2, bits)
  indexed.frames.forEach((idx, i) => {
    const delay = opts.delaysCs[i] ?? opts.delaysCs[opts.delaysCs.length - 1] ?? 10
    w.byte(0x21); w.byte(0xf9); w.byte(4)
    // disposal 2 (restore to background) so transparent pixels do not smear
    w.byte((2 << 2) | (indexed.transparent >= 0 ? 1 : 0))
    w.short(delay)
    w.byte(indexed.transparent >= 0 ? indexed.transparent : 0)
    w.byte(0)

    w.byte(0x2c)
    w.short(0); w.short(0)
    w.short(width); w.short(height)
    w.byte(0) // no local table, not interlaced
    w.byte(minCodeSize)
    writeSubBlocks(w, lzwCompress(idx, minCodeSize))
  })

  w.byte(0x3b)
  return { bytes: w.toUint8Array(), warnings }
}
