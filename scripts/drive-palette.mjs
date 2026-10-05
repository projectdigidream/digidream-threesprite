#!/usr/bin/env node
/**
 * Browser-driven check of the palette editor (desktop and phone layouts).
 *
 *   pnpm dev &                      # Vite on :1420
 *   node scripts/drive-palette.mjs [outDir]
 *
 * Paints with a PICO-8 colour, edits that swatch with recolouring on, checks
 * the painted pixels followed, undoes, switches palettes, then takes every
 * palette file format out and back in through the real dialogs — including a
 * PNG swatch strip and a qPainter project — and screenshots each step.
 * Exit 1 on any failure.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const fail = (msg) => { console.error('FAIL:', msg); errors.push(msg) }
const expect = (cond, msg) => { if (!cond) fail(msg) }

async function run(page, tag) {
  let n = 0
  const shot = async (name) => { n++; const p = join(outDir, `${tag}-${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }
  const state = () => page.evaluate(() => {
    const s = window.__editorStore.getState()
    const pal = s.doc.palettes[s.doc.activePaletteId]
    return { paletteName: pal.name, colors: pal.colors, order: s.doc.paletteOrder.length, primary: s.ui.primary, undo: s.history.undo.map(h => h.label) }
  })
  const pixel = (x, y) => page.evaluate(([x, y]) => {
    const s = window.__editorStore.getState()
    const partId = s.doc.partOrder[0]
    const img = s.doc.parts[partId].variants[s.doc.parts[partId].defaultVariant].images[1]
    const i = (y * img.width + x) * 4
    return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]]
  }, [x, y])

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ name: 'Palette drive', canvasSize: 16, viewCount: 8 })))
  await page.waitForTimeout(150)
  await shot('draw')

  // Open the editor and create a PICO-8 palette from the preset.
  await page.locator('button[title^="Palettes"]').first().click()
  await page.waitForSelector('.paled')
  await shot('editor-open')
  await page.locator('.paled__preset:has-text("PICO-8")').click()
  await page.waitForTimeout(100)
  let st = await state()
  expect(st.paletteName === 'PICO-8' && st.colors.length === 16, `PICO-8 palette active with 16 colours, got ${st.paletteName} ${st.colors.length}`)
  expect(await page.locator('.paled__grid .swatch:not(.swatch--add)').count() === 16, 'editor grid shows 16 swatches')
  await shot('editor-pico8')

  // Select swatch 9 (#ff004d) in the editor: it becomes the brush colour.
  await page.locator('.paled__grid .swatch').nth(8).click()
  st = await state()
  expect(st.primary.join() === '255,0,77,255', `swatch 9 is the brush colour, got ${st.primary}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  expect(await page.locator('.paled').count() === 0, 'Escape closes the editor')

  // Paint every pixel of the image with it (fill on the empty canvas).
  await page.locator('button[aria-label="Fill"]').first().click()
  const box = await page.locator('.pixel-canvas__surface').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(100)
  expect((await pixel(3, 3)).join() === '255,0,77,255', 'fill painted the PICO-8 colour')
  await shot('painted')

  // Edit that swatch with recolouring on: the painted pixels must follow, as one undo step.
  await page.locator('button[title^="Palettes"]').first().click()
  await page.waitForSelector('.paled')
  await page.locator('.paled__grid .swatch').nth(8).click()
  const undoBefore = (await state()).undo.length
  const hexField = page.locator('.paled__hex')
  await hexField.fill('#00ff00')
  await hexField.press('Enter')
  await page.waitForTimeout(150)
  st = await state()
  expect(st.colors[8].join() === '0,255,0,255', `swatch 9 is now green, got ${st.colors[8]}`)
  expect((await pixel(3, 3)).join() === '0,255,0,255', 'painted pixels were recoloured')
  expect(st.undo.length === undoBefore + 1 && st.undo[st.undo.length - 1] === 'Edit colour', `one "Edit colour" undo step, got ${st.undo.slice(-2)}`)
  expect(st.primary.join() === '0,255,0,255', 'the brush colour followed the swatch')
  await shot('recoloured')

  // Slider drag: preview while dragging, single commit on release.
  const slider = page.locator('.slider input[type=range]').first()
  const sb = await slider.boundingBox()
  await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2, { steps: 6 })
  await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  st = await state()
  expect(st.colors[8][0] === 255 && st.colors[8][1] === 255, `red slider dragged to 255, got ${st.colors[8]}`)
  expect((await pixel(3, 3)).join() === '255,255,0,255', 'pixels followed the slider')
  expect(st.undo.length === undoBefore + 2, `slider drag added exactly one undo step, got ${st.undo.length - undoBefore}`)
  await shot('slider')

  // Undo twice restores the PICO-8 colour in both the palette and the pixels.
  await page.evaluate(() => { window.__editorStore.getState().undo(); window.__editorStore.getState().undo() })
  await page.waitForTimeout(100)
  st = await state()
  expect(st.colors[8].join() === '255,0,77,255' && (await pixel(3, 3)).join() === '255,0,77,255', 'undo restored the swatch and the pixels')

  // Reorder, remove, sort, add from artwork.
  await page.locator('.paled__grid .swatch').nth(8).click()
  await page.locator('button[title="Move left"]').click()
  st = await state()
  expect(st.colors[7].join() === '255,0,77,255', 'move left')
  await page.locator('button[title^="Remove colour"]').click()
  st = await state()
  expect(st.colors.length === 15 && !st.colors.some(c => c.join() === '255,0,77,255'), 'remove colour')
  await page.locator('button:has-text("Add colours from artwork")').click()
  await page.waitForTimeout(100)
  st = await state()
  expect(st.colors.length === 16 && st.colors[15].join() === '255,0,77,255', 'add colours from artwork appended the painted colour')
  await shot('edited-list')

  // Switch back to the first palette from the editor's select, then from the panel.
  const firstId = await page.evaluate(() => window.__editorStore.getState().doc.paletteOrder[0])
  await page.locator('.paled__select').selectOption(firstId)
  st = await state()
  expect(st.paletteName === 'DawnBringer 16' && st.colors.length === 16, `switched to DawnBringer 16, got ${st.paletteName}`)
  await page.keyboard.press('Escape')
  if (tag === 'desktop') {
    const picoId = await page.evaluate(() => { const s = window.__editorStore.getState(); return s.doc.paletteOrder.find(id => s.doc.palettes[id].name === 'PICO-8') })
    await page.locator('.palette__select').selectOption(picoId)
    st = await state()
    expect(st.paletteName === 'PICO-8', 'panel select switches the palette')
    expect(await page.locator('.palette__grid .swatch').count() === 16, 'panel shows the active palette')
  }
  await shot('switched')

  // Take the palette out in each format, then bring it back in.
  await page.locator('button[title^="Palettes"]').first().click()
  await page.waitForSelector('.paled')
  const before = (await state()).colors
  const save = async (choice, name) => {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('select[aria-label="Export palette"]').selectOption(choice),
    ])
    const path = join(outDir, `${tag}-${name}`)
    await dl.saveAs(path)
    return path
  }
  const pngPath = await save('all:png', 'palette.png')
  const palPath = await save('all:pal', 'palette.pal')
  const hexUsed = await save('used:hex', 'used.hex')
  const palText = readFileSync(palPath, 'utf8')
  expect(palText.startsWith('JASC-PAL\r\n0100\r\n' + before.length), `the .pal header names ${before.length} colours: ${JSON.stringify(palText.slice(0, 24))}`)
  const usedText = readFileSync(hexUsed, 'utf8').trim()
  const painted = (await pixel(3, 3)).slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')
  expect(usedText.split('\n').includes(painted), `the used-colours export holds the painted colour ${painted}: ${JSON.stringify(usedText)}`)
  const strip = readFileSync(pngPath)
  expect(strip[0] === 0x89 && strip[1] === 0x50, 'the swatch strip is a PNG')
  await shot('exported')

  // The PNG strip comes back as the same colours, in the same order.
  const importFile = async (mode, path) => {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('select[aria-label="Import palette"]').selectOption(mode),
    ])
    await chooser.setFiles(path)
    await page.waitForTimeout(350)
  }
  await importFile('replace', pngPath)
  st = await state()
  expect(st.colors.length === before.length, `the strip came back with ${st.colors.length} of ${before.length} colours`)
  expect(JSON.stringify(st.colors.map(c => c.slice(0, 3))) === JSON.stringify(before.map(c => c.slice(0, 3))),
    'the strip came back in the same order')
  await shot('imported-png')

  // Adding only brings in what is missing.
  const hexPath = join(outDir, 'import-test.hex')
  writeFileSync(hexPath, '112233\n445566\n#778899\n')
  const countBeforeAdd = (await state()).colors.length
  await importFile('add', hexPath)
  st = await state()
  expect(st.colors.length === countBeforeAdd + 3, `adding three colours took it to ${st.colors.length} from ${countBeforeAdd}`)
  await importFile('add', hexPath)
  // the second time it has nothing to add, and says so
  await page.waitForSelector('[role="alertdialog"]', { timeout: 3000 })
  expect(/already in/.test(await page.locator('[role="alertdialog"]').innerText()), 'it says the colours are already there')
  await page.locator('[role="alertdialog"] button').last().click() // Escape here would close the editor behind it too
  await page.waitForTimeout(200)
  expect(await page.locator('.paled').count() === 1, 'the palette editor is still open behind the notice')
  st = await state()
  expect(st.colors.length === countBeforeAdd + 3, `adding the same file again changed nothing, got ${st.colors.length}`)

  // A qPainter project hands over its palette.
  const texproj = join(outDir, 'cave.texproj.json')
  writeFileSync(texproj, JSON.stringify({ w: 64, h: 64, active: 0, palette: [[17, 34, 51, 255], [68, 85, 102, 255]], ramps: [], layers: [] }))
  await importFile('replace', texproj)
  st = await state()
  expect(st.paletteName === 'cave' && st.colors.length === 2 && st.colors[0].join() === '17,34,51,255',
    `the qPainter project landed as "${st.paletteName}" with ${st.colors.length} colours`)
  await shot('imported-texproj')

  // A plain .hex replaces, as before.
  await importFile('replace', hexPath)
  st = await state()
  expect(st.paletteName === 'import-test' && st.colors.length === 3 && st.colors[2].join() === '119,136,153,255', `imported palette active, got ${st.paletteName} ${st.colors.length}`)
  await shot('imported')

  // Delete it (confirm dialog) → back to a neighbour.
  const countBeforeDelete = (await state()).order
  await page.locator('.paled button:has-text("Delete")').click()
  await page.waitForSelector('.modal--small')
  await page.locator('.modal--small button:has-text("Delete")').click()
  await page.waitForTimeout(100)
  st = await state()
  expect(st.order === countBeforeDelete - 1 && st.paletteName !== 'import-test',
    `deleted the imported palette: ${countBeforeDelete} → ${st.order}, now on ${st.paletteName}`)
  await page.keyboard.press('Escape')
  await shot('done')
}

for (const [tag, ctxOpts] of [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  ['mobile', { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const context = await browser.newContext({ ...ctxOpts, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', e => fail(`${tag} pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') fail(`${tag} console: ${m.text()}`) })
  try { await run(page, tag) } catch (e) { fail(`${tag} threw: ${e.message}`) }
  await context.close()
}

await browser.close()
if (errors.length) { console.error(`\n${errors.length} problem(s)`); process.exit(1) }
console.log('palette drive ok')
