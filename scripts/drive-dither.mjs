#!/usr/bin/env node
/**
 * Drives the dither tool through the real UI: pick it, set a density and an
 * offset in the panel, drag across the canvas, and read the pixels back.
 *
 *   pnpm dev &
 *   node scripts/drive-dither.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const expect = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); errors.push(msg) } else console.log('ok:', msg) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ name: 'Dither drive', canvasSize: 32, viewCount: 4 })))
await page.waitForTimeout(200)

/** The current part's image for view 1, as a row of alpha values. */
const rowAlpha = (y) => page.evaluate((y) => {
  const s = window.__editorStore.getState()
  const part = s.doc.parts[s.ui.selectedPartId]
  const img = part.variants[part.defaultVariant].images[1]
  const out = []
  for (let x = 0; x < img.width; x++) out.push(img.pixels[(y * img.width + x) * 4 + 3] > 0 ? 1 : 0)
  return out
}, y)

// the tool is hidden until picked, and its settings appear with it
expect(await page.locator('.tool-panel__dither').count() === 0, 'the dither settings stay out of the way until the tool is picked')
await page.keyboard.press('d')
await page.waitForTimeout(150)
expect(await page.evaluate(() => window.__editorStore.getState().ui.tool) === 'dither', 'D picks the dither tool')
expect(await page.locator('.tool-panel__dither').count() === 1, 'its density and offset appear in the panel')
await page.screenshot({ path: join(outDir, 'dither-01-panel.png') })

// half density across a row: every other pixel
const box = await page.locator('.pixel-canvas__surface').boundingBox()
const drag = async (yOffset) => {
  const y = box.y + box.height / 2 + yOffset
  await page.mouse.move(box.x + box.width / 2 - 100, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 100, y, { steps: 24 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}
await drag(0)
const painted = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const part = s.doc.parts[s.ui.selectedPartId]
  const img = part.variants[part.defaultVariant].images[1]
  const rows = new Set()
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.pixels[(y * img.width + x) * 4 + 3] > 0) rows.add(y)
  return [...rows]
})
expect(painted.length === 1, `the stroke stayed on one row (${painted})`)
const half = await rowAlpha(painted[0])
const on = half.filter(Boolean).length
expect(on > 0 && on < half.length, `half density leaves gaps (${on} of ${half.length} painted)`)
expect(half.join('').includes('1010') || half.join('').includes('0101'), `and alternates: ${half.join('')}`)
expect(await page.evaluate(() => window.__editorStore.getState().history.undo.at(-1)?.label) === 'Dither', 'the stroke is one undoable "Dither" step')

// the offset meshes with the previous pass: the same row, other phase, fills the gaps
await page.locator('.dither-offset').click()
expect(await page.evaluate(() => window.__editorStore.getState().ui.ditherOffset) === 1, 'the offset button steps the phase')
await drag(0)
const meshed = await rowAlpha(painted[0])
// only inside the span the stroke actually covered; the rest of the row is untouched
const first = half.indexOf(1)
const last = half.lastIndexOf(1)
expect(meshed.slice(first, last + 1).every(Boolean), `a second pass at the next offset fills the gaps (${meshed.join('')})`)

// density drives coverage. Ordered dithering only averages out over a whole
// 4×4 tile, so this measures an area four pixels tall rather than one row.
const slider = page.locator('.tool-panel__dither input[type=range]')
const painted4Rows = async (density) => {
  await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ canvasSize: 32, viewCount: 4 })))
  await page.keyboard.press('d')
  await page.waitForTimeout(120)
  await page.locator('.tool-panel__sizes .size-btn').nth(3).click()   // a 4px brush spans a full tile
  await slider.fill(String(density))
  await page.waitForTimeout(100)
  await drag(0)
  return page.evaluate(() => {
    const s = window.__editorStore.getState()
    const part = s.doc.parts[s.ui.selectedPartId]
    const img = part.variants[part.defaultVariant].images[1]
    let n = 0
    for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i] > 0) n++
    return n
  })
}
const atQuarter = await painted4Rows(4)
const atHalf = await painted4Rows(8)
const atThreeQuarters = await painted4Rows(12)
expect(atQuarter < atHalf && atHalf < atThreeQuarters, `coverage climbs with density (${atQuarter} < ${atHalf} < ${atThreeQuarters})`)
expect((await page.locator('.tool-panel__dither span').innerText()).trim() === '75%', 'the readout follows the slider')
await page.screenshot({ path: join(outDir, 'dither-02-strokes.png') })

// full density is an ordinary stroke
await page.locator('.tool-panel__sizes .size-btn').nth(0).click()
await slider.fill('16')
await page.waitForTimeout(100)
await drag(20)
const full = await rowAlpha(await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const part = s.doc.parts[s.ui.selectedPartId]
  const img = part.variants[part.defaultVariant].images[1]
  let last = 0
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.pixels[(y * img.width + x) * 4 + 3] > 0) last = y
  return last
}))
const span = full.join('').replace(/^0+|0+$/g, '')
expect(span.length > 10 && !span.includes('0'), `full density draws a solid line (${span.length}px unbroken)`)

await browser.close()
if (errors.length) { console.error(`\n${errors.length} problem(s)`); process.exit(1) }
console.log('\ndither drive ok')
