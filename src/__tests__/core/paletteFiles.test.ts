import { describe, it, expect } from 'vitest'
import { paletteFileBytes } from '../../core/io/paletteActions'
import { imageFromPng } from '../../core/io/projectFile'
import { createImage, setPixel } from '../../domain/image'
import {
  colorsFromPixels, MAX_PALETTE, parsePaletteText, paletteStripImage,
  serializeGplPalette, serializeHexPalette, serializeJascPalette, usedColors,
} from '../../domain/palette'
import { addBone, addPart, createProject } from '../../domain/project'
import type { RGBA } from '../../domain/types'

const RED: RGBA = [214, 62, 62, 255]
const BLUE: RGBA = [62, 110, 214, 255]
const GREEN: RGBA = [90, 190, 110, 255]

describe('JASC .pal', () => {
  it('writes the header, version and count, CRLF throughout', () => {
    expect(serializeJascPalette([RED, BLUE])).toBe('JASC-PAL\r\n0100\r\n2\r\n214 62 62\r\n62 110 214\r\n')
    expect(serializeJascPalette([])).toBe('JASC-PAL\r\n0100\r\n0\r\n\r\n')
  })

  it('round-trips through the reader', () => {
    expect(parsePaletteText(serializeJascPalette([RED, BLUE, GREEN]))).toEqual([RED, BLUE, GREEN])
  })

  it('reads one written by qPainter', () => {
    // byte for byte what its `toPal` produces
    const theirs = 'JASC-PAL\r\n0100\r\n3\r\n214 62 62\r\n62 110 214\r\n90 190 110\r\n'
    expect(parsePaletteText(theirs)).toEqual([RED, BLUE, GREEN])
  })
})

describe('the other text formats qPainter writes', () => {
  it('reads its .gpl, which pads nothing and ends each row with the hex', () => {
    const theirs = 'GIMP Palette\nName: texture\nColumns: 8\n#\n214 62 62\t#d63e3e\n62 110 214\t#3e6ed6\n'
    expect(parsePaletteText(theirs)).toEqual([RED, BLUE])
  })

  it('reads its .hex', () => {
    expect(parsePaletteText('d63e3e\n3e6ed6\n5abe6e\n')).toEqual([RED, BLUE, GREEN])
  })

  it('and it can read ours back', () => {
    // their parser: GIMP by first line, then `^(\d+)\s+(\d+)\s+(\d+)` per line
    const gpl = serializeGplPalette('sprite', [RED, BLUE])
    expect(gpl.startsWith('GIMP Palette')).toBe(true)
    const rows = gpl.split('\n').slice(4).filter(Boolean)
    expect(rows.map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/)!.slice(1, 4).map(Number)))
      .toEqual([[214, 62, 62], [62, 110, 214]])
    // their .hex reader takes `#?[0-9a-f]{6}` tokens
    expect(serializeHexPalette([RED]).trim()).toBe('d63e3e')
  })
})

describe('a palette out of a JSON project', () => {
  it('takes qPainter\'s `palette`', () => {
    const texproj = JSON.stringify({ w: 64, h: 64, active: 0, palette: [[214, 62, 62, 255], [62, 110, 214, 255]], ramps: [], layers: [] })
    expect(parsePaletteText(texproj)).toEqual([RED, BLUE])
  })

  it('takes the active one out of our own project.json', () => {
    const ours = JSON.stringify({
      formatVersion: 3,
      palettes: { a: { id: 'a', name: 'first', colors: [[1, 2, 3, 255]] }, b: { id: 'b', name: 'second', colors: [[214, 62, 62, 255]] } },
      activePaletteId: 'b',
    })
    expect(parsePaletteText(ours)).toEqual([RED])
  })

  it('says nothing rather than guessing when there is no palette in it', () => {
    expect(parsePaletteText('{"hello":1}')).toEqual([])
    expect(parsePaletteText('{ not json')).toEqual([])
  })
})

describe('the PNG swatch strip', () => {
  it('is one opaque pixel per colour on a single row', () => {
    const img = paletteStripImage([RED, BLUE, GREEN])
    expect([img.width, img.height]).toEqual([3, 1])
    expect(Array.from(img.pixels)).toEqual([...RED, ...BLUE, ...GREEN])
  })

  it('stays a real image when the palette is empty', () => {
    const img = paletteStripImage([])
    expect([img.width, img.height]).toEqual([1, 1])
  })

  it('round-trips through a real PNG', () => {
    const colors = [RED, BLUE, GREEN]
    const png = paletteFileBytes('p', 'png', colors)
    expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    const back = imageFromPng(png)
    expect([back.width, back.height]).toEqual([3, 1])
    expect(colorsFromPixels(back.pixels)).toEqual(colors)
  })
})

describe('colours out of an image', () => {
  it('keeps the order they first appear in', () => {
    const img = createImage(3, 2)
    setPixel(img, 0, 0, BLUE)
    setPixel(img, 1, 0, RED)
    setPixel(img, 2, 0, BLUE) // a repeat does not move it
    setPixel(img, 0, 1, GREEN)
    expect(colorsFromPixels(img.pixels)).toEqual([BLUE, RED, GREEN])
  })

  it('ignores anything below half alpha, since a palette is opaque', () => {
    const img = createImage(2, 1)
    setPixel(img, 0, 0, RED)
    setPixel(img, 1, 0, [10, 20, 30, 100])
    expect(colorsFromPixels(img.pixels)).toEqual([RED])
  })

  it('cuts down to the limit by median cut, keeping the extremes apart', () => {
    const img = createImage(64, 1)
    for (let x = 0; x < 64; x++) setPixel(img, x, 0, [x * 4, 0, 255 - x * 4, 255])
    const few = colorsFromPixels(img.pixels, 4)
    expect(few).toHaveLength(4)
    expect(few[0][0]).toBeLessThan(few[3][0]) // still runs dark to light along the ramp
    expect(colorsFromPixels(img.pixels, 200)).toHaveLength(64) // under the limit nothing is touched
  })

  it('never returns more than a palette can hold', () => {
    const img = createImage(512, 2)
    for (let i = 0; i < 1024; i++) setPixel(img, i % 512, Math.floor(i / 512), [i & 255, (i >> 2) & 255, (i >> 4) & 255, 255])
    expect(colorsFromPixels(img.pixels).length).toBeLessThanOrEqual(MAX_PALETTE)
  })
})

describe('the colours a sprite uses', () => {
  function spriteProject() {
    const p = createProject({ canvasSize: 16, viewCount: 2, mirror: false, starter: false })
    const bone = addBone(p, { name: 'body', length: 8 })
    const img = createImage(4, 1)
    setPixel(img, 0, 0, GREEN) // off-palette, met first
    setPixel(img, 1, 0, BLUE)
    setPixel(img, 2, 0, [0, 0, 0, 0]) // transparent: never counts
    const part = addPart(p, { boneId: bone.id, image: img })
    return { p, part }
  }

  it('lists the palette\'s own first in palette order, then the rest as met', () => {
    const { p } = spriteProject()
    expect(usedColors(p, [RED, BLUE])).toEqual([BLUE, GREEN]) // RED is in the palette but unused
  })

  it('is just the used colours when the palette is empty', () => {
    const { p } = spriteProject()
    expect(usedColors(p, [])).toEqual([GREEN, BLUE])
  })

  it('looks at every variant and view, not only the first', () => {
    const { p, part } = spriteProject()
    const other = createImage(1, 1)
    setPixel(other, 0, 0, RED)
    p.parts[part.id].variants[part.defaultVariant].images[2] = other
    expect(usedColors(p, [])).toEqual([GREEN, BLUE, RED])
  })

  it('is empty for a sprite with nothing drawn', () => {
    const p = createProject({ canvasSize: 16, starter: false })
    expect(usedColors(p, [RED])).toEqual([])
  })
})
