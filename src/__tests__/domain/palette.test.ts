import { describe, it, expect } from 'vitest'
import {
  addColor, collectImageColors, DEFAULT_PALETTE, hexToRgba, insertColor, MAX_PALETTE, moveColor, parsePaletteText, presetNameFor, PRESET_PALETTES,
  recolorProject, replaceColorCopy, rgbaToHex, serializeGplPalette, serializeHexPalette, sortColors,
} from '../../domain/palette'
import { createProject, setPartImage } from '../../domain/project'
import type { RGBA } from '../../domain/types'
import { ascii, BLUE, GREEN, RED, toAscii } from '../fixtures/pixels'

describe('preset palettes', () => {
  it('are well-formed, opaque and free of duplicates', () => {
    expect(new Set(PRESET_PALETTES.map(p => p.name)).size).toBe(PRESET_PALETTES.length)
    for (const p of PRESET_PALETTES) {
      expect(p.colors.length).toBeGreaterThan(0)
      expect(p.colors.length).toBeLessThanOrEqual(MAX_PALETTE)
      for (const c of p.colors) {
        expect(c).toHaveLength(4)
        for (const v of c) { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255) }
        expect(c[3]).toBe(255)
      }
      expect(new Set(p.colors.map(rgbaToHex)).size).toBe(p.colors.length)
    }
    expect(PRESET_PALETTES.find(p => p.name === 'PICO-8')?.colors).toHaveLength(16)
    expect(PRESET_PALETTES.find(p => p.name === 'DawnBringer 32')?.colors).toHaveLength(32)
  })

  it('the default palette is the first preset and is recognised by name', () => {
    expect(DEFAULT_PALETTE).toBe(PRESET_PALETTES[0].colors)
    expect(presetNameFor(DEFAULT_PALETTE)).toBe('DawnBringer 16')
    expect(presetNameFor([...DEFAULT_PALETTE].reverse())).toBeNull()
    expect(presetNameFor([])).toBeNull()
  })
})

describe('palette files', () => {
  it('reads hex lists with or without #, 0x, comments and trailing alpha', () => {
    const text = '#ff0000\n00ff00 ; green\n// a comment line\n0x0000ff, 112233ff\nnot-a-colour\n\n'
    expect(parsePaletteText(text)).toEqual([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [17, 34, 51, 255]])
  })

  it('drops duplicate colours and ignores empty input', () => {
    expect(parsePaletteText('ff0000\n#FF0000\nFf0000')).toHaveLength(1)
    expect(parsePaletteText('')).toEqual([])
    expect(parsePaletteText('hello world')).toEqual([])
  })

  it('reads GIMP .gpl and JASC .pal files', () => {
    const gpl = 'GIMP Palette\nName: Test\nColumns: 2\n#\n  0   0   0\tblack\n255 255 255\twhite\n# trailing comment\n'
    expect(parsePaletteText(gpl)).toEqual([[0, 0, 0, 255], [255, 255, 255, 255]])
    const pal = 'JASC-PAL\r\n0100\r\n2\r\n255 0 0\r\n0 0 255\r\n'
    expect(parsePaletteText(pal)).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]])
  })

  it('round-trips through .hex and .gpl', () => {
    const cols = PRESET_PALETTES.find(p => p.name === 'Sweetie 16')!.colors
    expect(parsePaletteText(serializeHexPalette(cols))).toEqual(cols)
    expect(parsePaletteText(serializeGplPalette('Sweetie 16', cols))).toEqual(cols)
    expect(serializeHexPalette([[255, 0, 128, 255]])).toBe('ff0080\n')
    expect(serializeGplPalette('My pal', [[1, 2, 3, 255]])).toBe('GIMP Palette\nName: My pal\nColumns: 8\n#\n  1   2   3\t#010203\n')
  })

  it('hex helpers', () => {
    expect(hexToRgba('#0A0b0C')).toEqual([10, 11, 12, 255])
    expect(hexToRgba('0a0b0c', 7)).toEqual([10, 11, 12, 7])
    expect(hexToRgba('zzz')).toBeNull()
    expect(rgbaToHex([1, 2, 3, 255])).toBe('#010203')
  })
})

describe('recolouring', () => {
  it('replaceColorCopy leaves the source untouched and returns null when nothing matches', () => {
    const img = ascii(['XG.', '.XB'])
    const out = replaceColorCopy(img, RED, BLUE)
    expect(out).not.toBeNull()
    expect(out!.pixels).not.toBe(img.pixels)
    expect(toAscii(img.pixels, 3, 2)).toEqual(['XG.', '.XB'])
    expect(toAscii(out!.pixels, 3, 2)).toEqual(['BG.', '.BB'])
    expect(replaceColorCopy(img, [9, 9, 9, 255], BLUE)).toBeNull()
  })

  it('recolorProject swaps only the images that contain the colour', () => {
    const p = createProject({ canvasSize: 8 })
    const partId = p.partOrder[0]
    const vid = p.parts[partId].defaultVariant
    setPartImage(p, partId, vid, 1, ascii(['X.', '.G']))
    setPartImage(p, partId, vid, 2, ascii(['G.', '.G']))
    const untouched = p.parts[partId].variants[vid].images[2]
    expect(recolorProject(p, RED, BLUE)).toBe(1)
    expect(p.parts[partId].variants[vid].images[2]).toBe(untouched)
    expect(toAscii(p.parts[partId].variants[vid].images[1].pixels, 2, 2)).toEqual(['B.', '.G'])
    expect(recolorProject(p, RED, RED)).toBe(0)
    expect(recolorProject(p, RED, GREEN)).toBe(0)
  })

  it('collectImageColors lists distinct opaque colours, dark to light', () => {
    const p = createProject({ canvasSize: 8 })
    const partId = p.partOrder[0]
    const vid = p.parts[partId].defaultVariant
    setPartImage(p, partId, vid, 1, ascii(['XG', 'G.']))
    setPartImage(p, partId, vid, 2, ascii(['B.', 'XX']))
    expect(collectImageColors(p)).toEqual([BLUE, RED, GREEN])
  })
})

describe('colour list operations', () => {
  it('moves, inserts, adds and sorts', () => {
    const cols: RGBA[] = [RED, GREEN, BLUE]
    expect(moveColor(cols, 0, 2)).toBe(2)
    expect(cols).toEqual([GREEN, BLUE, RED])
    expect(moveColor(cols, 2, -5)).toBe(0)
    expect(cols).toEqual([RED, GREEN, BLUE])
    expect(moveColor(cols, 1, 1)).toBe(1)
    expect(addColor(cols, RED)).toBe(0)
    expect(cols).toHaveLength(3)
    expect(insertColor(cols, 1, [1, 1, 1, 255])).toBe(1)
    expect(cols[1]).toEqual([1, 1, 1, 255])
    sortColors(cols)
    expect(cols).toEqual([[1, 1, 1, 255], BLUE, RED, GREEN])
  })

  it('refuses to grow past MAX_PALETTE', () => {
    const cols: RGBA[] = Array.from({ length: MAX_PALETTE }, (_, i) => [i, 0, 0, 255] as const)
    expect(addColor(cols, [0, 1, 0, 255])).toBe(-1)
    expect(insertColor(cols, 0, [0, 1, 0, 255])).toBe(-1)
    expect(addColor(cols, [5, 0, 0, 255])).toBe(5)
    expect(cols).toHaveLength(MAX_PALETTE)
  })
})
