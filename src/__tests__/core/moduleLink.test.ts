import { afterEach, describe, expect, it } from 'vitest'
import { importModulePalette, importModuleTexture, textureColours, textureImage } from '../../core/io/moduleLink'
import { pngFromImage } from '../../core/io/projectFile'
import { dialogStore, resolveCurrent } from '../../core/ui/dialogs'
import { createImage } from '../../domain/image'
import { createProject } from '../../domain/project'
import { editorStore } from '../../store/editorStore'

const w = window as unknown as { threespriteHost?: unknown }
const dataUrl = (c: [number, number, number, number]) => {
  const png = pngFromImage(createImage(4, 4, c))
  let s = ''; for (const b of png) s += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(s)}`
}
/** A 4×4 qPainter project: an opaque red base, a hidden green layer, a half-transparent blue one on top. */
const texproj = new TextEncoder().encode(JSON.stringify({
  w: 4, h: 4, frame: 0, palette: [[255, 0, 0, 255], [0, 0, 255, 255]],
  layers: [
    { visible: true, opacity: 1, cels: [dataUrl([255, 0, 0, 255])] },
    { visible: false, opacity: 1, cels: [dataUrl([0, 255, 0, 255])] },
    { visible: true, opacity: 0.5, cels: [dataUrl([0, 0, 255, 255])] },
  ],
}))

afterEach(() => { delete w.threespriteHost })

describe("the module's textures", () => {
  it('flatten a qPainter project: visible layers only, each at its opacity', () => {
    const img = textureImage(texproj)
    expect([img.width, img.height]).toEqual([4, 4])
    expect(Array.from(img.pixels.slice(0, 4)).map(Math.round)).toEqual([128, 0, 128, 255])
  })

  it("give their own palette, or a PNG's colours", () => {
    expect(textureColours(texproj)).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]])
    expect(textureColours(pngFromImage(createImage(2, 2, [9, 8, 7, 255])))).toEqual([[9, 8, 7, 255]])
  })

  it('become a new part, picked from the list the host gives', async () => {
    editorStore.getState().loadProject(createProject({ canvasSize: 16 }))
    w.threespriteHost = { open: async () => null, save: async () => true, library: { textures: async () => ['BRICK'], texture: async () => texproj, palette: async () => null } }
    const adding = importModuleTexture()
    await new Promise(r => setTimeout(r, 0))
    expect(dialogStore.getState().queue[0]).toMatchObject({ kind: 'choice', options: ['BRICK'] })
    resolveCurrent('BRICK')
    const id = await adding
    const part = editorStore.getState().doc.parts[id!]
    expect(part.name).toBe('BRICK')
    expect(part.variants[part.defaultVariant].images[1].width).toBe(4)
  })

  it("read the module palette (digidream-palette: #rrggbb strings)", async () => {
    const palette = JSON.stringify({ format: 'digidream-palette', version: 1, name: 'Starter', colors: ['#000000', '#1D2B53'] })
    w.threespriteHost = { open: async () => null, save: async () => true, library: { textures: async () => ['BRICK'], texture: async () => texproj, palette: async () => palette } }
    const picking = importModulePalette()
    await new Promise(r => setTimeout(r, 0))
    expect(dialogStore.getState().queue[0]).toMatchObject({ kind: 'choice', options: ["The module's palette", 'Texture BRICK'] })
    resolveCurrent("The module's palette")
    expect(await picking).toEqual({ name: 'Module', colors: [[0, 0, 0, 255], [29, 43, 83, 255]] })
  })
})
