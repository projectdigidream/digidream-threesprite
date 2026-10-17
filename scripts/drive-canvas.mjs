#!/usr/bin/env node
/**
 * The canvas's corner: the background the art is drawn over (dark art on the
 * dark checks vanishes), kept on this device across a reload; and in Animate
 * the bones, which hide on request and while playing, and cannot be dragged
 * while hidden.
 *   pnpm dev &   then   node scripts/drive-canvas.mjs [outDir] [--mobile]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mobile = args.includes('--mobile')
const outDir = args.find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
const context = await browser.newContext(mobile
  ? { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `canvas-${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }
const expect = (ok, msg) => { if (!ok) errors.push(msg) }

// a navy shroud on a 32px sprite, like the playtest's wraith
const load = () => page.evaluate(async () => {
  const { createImage, setPixel } = await import('/src/domain/image.ts')
  const p = window.__createProject({ name: 'Wraith', canvasSize: 32, viewCount: 1 })
  const part = p.parts[p.partOrder[0]]
  const img = createImage(32, 32)
  for (let y = 4; y < 28; y++) for (let x = 0; x < 32; x++) {
    const half = 3 + (y - 4) / 3
    if (Math.abs(x - 15.5) < half) setPixel(img, x, y, (x + y) % 7 ? [48, 52, 109, 255] : [68, 36, 52, 255])
  }
  part.variants[part.defaultVariant].images[1] = img
  window.__editorStore.getState().loadProject(p)
})
/** The screen colour over sprite pixel (sx, sy). */
const at = (sx, sy) => page.evaluate(([sx, sy]) => {
  const s = window.__editorStore.getState(); const c = document.querySelector('.pixel-canvas__surface')
  const r = c.getBoundingClientRect(); const k = c.width / r.width; const { zoom, pan } = s.ui
  const d = c.getContext('2d').getImageData(Math.round((pan.x + (sx + 0.5) * zoom) * k), Math.round((pan.y + (sy + 0.5) * zoom) * k), 1, 1).data
  return [d[0], d[1], d[2]]
}, [sx, sy])
const bright = c => (c[0] + c[1] + c[2]) / 3

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(400)
await load()
await page.waitForTimeout(300)
expect(bright(await at(2, 2)) < 70, `the default background is not the dark checks: ${await at(2, 2)}`)
await shot('dark')
// pick "Light checks" in the corner
await page.locator('.pixel-canvas__corner button[aria-label="Canvas background"]').click()
await page.locator('.pixel-canvas__backgrounds button[aria-label="Light checks"]').click()
await page.waitForTimeout(200)
expect(bright(await at(2, 2)) > 180, `light checks did not lighten the background: ${await at(2, 2)}`)
expect(!(await page.locator('.pixel-canvas__backgrounds').count()), 'the choices stay open after picking one')
await shot('light')
// kept on this device across a reload
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface')
await page.waitForTimeout(400)
await load()
await page.waitForTimeout(300)
expect(bright(await at(2, 2)) > 180, `the background choice did not survive a reload: ${await at(2, 2)}`)

// Animate: the bones are drawn over the art, hide on request, and cannot be dragged while hidden
await page.locator('.tab', { hasText: 'Animate' }).first().click()
await page.waitForTimeout(400)
// the bone runs up the sprite's centre line, x = 16.0 (at() adds half a pixel)
const boneColumn = async () => { let orange = 0; for (let y = 6; y < 30; y++) { const c = await at(15.5, y); if (c[0] > 200 && c[1] > 140 && c[1] < 200 && c[2] < 120) orange++ } return orange }
const shown = await boneColumn()
expect(shown > 3, `Animate does not draw the bone (found ${shown} orange pixels)`)
await shot('animate-bones')
await page.locator('.pixel-canvas__corner button[aria-label="Show bones"]').click()
await page.waitForTimeout(200)
const hidden = await boneColumn()
expect(hidden === 0, `hiding the bones left ${hidden} orange pixels`)
await shot('animate-no-bones')
// a drag along the hidden bone pans, it does not pose
const box = await page.locator('.pixel-canvas__surface').boundingBox()
const tip = await page.evaluate(() => { const s = window.__editorStore.getState(); return { x: s.ui.pan.x + 16 * s.ui.zoom, y: s.ui.pan.y + 12 * s.ui.zoom } })
await page.mouse.move(box.x + tip.x, box.y + tip.y)
await page.mouse.down()
await page.mouse.move(box.x + tip.x + 60, box.y + tip.y, { steps: 5 })
await page.mouse.up()
const undo = await page.evaluate(() => window.__editorStore.getState().history.undo.length)
expect(undo === 0, `a drag over the hidden bone made ${undo} edit(s)`)
// shown again, they still hide while the animation plays
await page.locator('.pixel-canvas__corner button[aria-label="Show bones"]').click()
await page.evaluate(() => window.__editorStore.getState().setUi({ playing: true }))
await page.waitForTimeout(300)
const playing = await boneColumn()
await page.evaluate(() => window.__editorStore.getState().setUi({ playing: false }))
expect(playing === 0, `the bones show while playing (${playing} orange pixels)`)
// Rig always shows them, and has no bones toggle
await page.locator('.tab', { hasText: 'Rig' }).first().click()
await page.waitForTimeout(300)
expect(!(await page.locator('.pixel-canvas__corner button[aria-label="Show bones"]').count()), 'Rig offers to hide the bones it edits')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('canvas drive passed')
