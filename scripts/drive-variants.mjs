#!/usr/bin/env node
/**
 * Part variants, as a user meets them: the canvas shows the variant being
 * painted (a stroke on it shows while it is drawn), a new variant starts as a
 * copy of the one on the canvas, and in Animate the timeline's bar keys a
 * variant at a frame, the frames before it keep the default, and the part's
 * row marks where the variant shows.
 *   pnpm dev &   then   node scripts/drive-variants.mjs [outDir] [--mobile]
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
// sideways on a phone: the timeline and its bar live in the right-hand rail
const context = await browser.newContext(mobile
  ? { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
page.on('dialog', d => { errors.push(`native dialog: ${d.type()}`); d.dismiss() })
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `variants-${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }
const expect = (ok, msg) => { if (!ok) errors.push(msg) }
const finish = async () => {
  await browser.close()
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
  console.log('variants drive passed')
  process.exit(0)
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(500)
// one part: the default variant a green block, "open" a red disc, in view 1
const ids = await page.evaluate(async () => {
  const { createProject, addVariant } = await import('/src/domain/project.ts')
  const { createImage, setPixel } = await import('/src/domain/image.ts')
  const p = createProject({ name: 'Variants', canvasSize: 32, viewCount: 4, mirror: false })
  const partId = p.partOrder[0]
  const part = p.parts[partId]
  const fill = (c, inside) => { const img = createImage(32, 32); for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (inside(x, y)) setPixel(img, x, y, c); return img }
  part.variants[part.defaultVariant].images[1] = fill([60, 200, 80, 255], (x, y) => x > 8 && x < 24 && y > 8 && y < 30)
  const open = addVariant(p, partId, 'open')
  open.images[1] = fill([230, 60, 60, 255], (x, y) => Math.hypot(x - 16, y - 18) < 9)
  window.__editorStore.getState().loadProject(p)
  return { partId, def: part.defaultVariant, open: open.id }
})

/** What the canvas shows at a sprite pixel, as 'green', 'red', 'white' or the RGB. */
const seen = (sx, sy) => page.evaluate(([sx, sy]) => {
  const s = window.__editorStore.getState()
  const c = document.querySelector('.pixel-canvas__surface')
  const r = c.getBoundingClientRect()
  const k = c.width / r.width
  const { zoom, pan } = s.ui
  // the sprite's top-left corner sits at the pan offset; read the screen pixel over sprite pixel (sx, sy)
  const x = pan.x + (sx + 0.5) * zoom
  const y = pan.y + (sy + 0.5) * zoom
  const d = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data
  if (d[1] > 150 && d[0] < 120) return 'green'
  if (d[0] > 180 && d[1] < 120) return 'red'
  if (d[0] > 200 && d[1] > 200 && d[2] > 200) return 'white'
  return `${d[0]},${d[1]},${d[2]}`
}, [sx, sy])
// sprite pixels: (12, 22) is inside both the block and the disc; (16, 6) is above both
const INSIDE = [12, 22]

expect(await seen(...INSIDE) === 'green', 'Draw: the default variant is not what the canvas shows')
// pick "open" in the Parts panel, as a user would
if (mobile) await page.locator('.icon-btn[title="Parts"]').click()
await page.locator('.part-list select').first().selectOption({ label: 'open' })
await page.waitForTimeout(250)
expect(await seen(...INSIDE) === 'red', `Draw: picking "open" left the canvas showing ${await seen(...INSIDE)}`)
await shot('draw-open')

// a stroke on "open", above the disc, must show while it is drawn
const spot = await page.evaluate(([sx, sy]) => {
  const s = window.__editorStore.getState(); const r = document.querySelector('.pixel-canvas__surface').getBoundingClientRect()
  const { zoom, pan } = s.ui
  return { x: r.left + pan.x + (sx + 0.5) * zoom, y: r.top + pan.y + (sy + 0.5) * zoom, zoom }
}, [16, 6])
await page.evaluate(() => window.__editorStore.getState().setUi({ primary: [250, 250, 250, 255], tool: 'pencil' }))
await page.mouse.move(spot.x - spot.zoom * 4, spot.y)
await page.mouse.down()
await page.mouse.move(spot.x, spot.y, { steps: 4 })
await page.waitForTimeout(150)
expect(await seen(16, 6) === 'white', `Draw: a stroke on "open" does not show while it is drawn (${await seen(16, 6)})`)
await page.mouse.up()
await page.waitForTimeout(150)
const painted = await page.evaluate(({ partId, def, open }) => {
  const p = window.__editorStore.getState().doc.parts[partId]
  const at = (vid) => { const img = p.variants[vid].images[1]; return img.pixels[(6 * img.width + 16) * 4 + 3] }
  return { def: at(def), open: at(open) }
}, ids)
expect(painted.open > 0 && painted.def === 0, `Draw: the stroke landed in the wrong variant ${JSON.stringify(painted)}`)

// a new variant starts as a copy of "open": the canvas does not change
await page.locator('.part-list button[title="Add variant"]').click()
await page.locator('.modal input').fill('open, bloody')
await page.locator('.modal button', { hasText: 'Add' }).click()
await page.waitForTimeout(250)
const added = await page.evaluate(({ partId }) => {
  const s = window.__editorStore.getState(); const p = s.doc.parts[partId]
  return { name: p.variants[s.ui.variantId]?.name, views: Object.keys(p.variants[s.ui.variantId]?.images ?? {}) }
}, ids)
expect(added.name === 'open, bloody' && added.views.join() === '1', `a new variant is not a copy of the one on the canvas: ${JSON.stringify(added)}`)
expect(await seen(...INSIDE) === 'red' && await seen(16, 6) === 'white', 'the new variant does not look like the one it was made from')
await shot('draw-new-variant')

// Animate: pick the part's row, then key "open" at frame 3 from the timeline's bar
await page.locator('.tab', { hasText: 'Animate' }).first().click()
await page.waitForTimeout(300)
await page.locator('.timeline__label', { hasText: 'body' }).last().click()
await page.evaluate(() => window.__editorStore.getState().setUi({ frame: 2 }))
await page.waitForTimeout(200)
const picker = page.locator('.transport__variant select')
if (!(await picker.count()) || !(await picker.isVisible())) { errors.push('Animate: no variant picker in the timeline bar'); await finish() }
await picker.selectOption({ label: 'open' })
await page.waitForTimeout(250)
const frames = []
for (const f of [0, 1, 2, 3]) {
  await page.evaluate(k => window.__editorStore.getState().setUi({ frame: k }), f)
  await page.waitForTimeout(120)
  frames.push(await seen(...INSIDE))
}
console.log('animate, frames 1–4:', frames.join(' '))
expect(frames.join() === 'green,green,red,red', `Animate: a variant keyed at frame 3 shows on frames ${frames.join(', ')}`)
await page.evaluate(() => window.__editorStore.getState().setUi({ frame: 2 }))
await page.waitForTimeout(150)
const row = await page.evaluate(() => {
  const strip = [...document.querySelectorAll('.timeline__variant')].map(el => ({ left: parseFloat(el.style.left), width: parseFloat(el.style.width), title: el.title }))
  const label = document.querySelector('.timeline__label-variant')?.textContent
  const cell = document.querySelector('.timeline__hcell')?.getBoundingClientRect().width
  return { strip, label, cell }
})
console.log('timeline:', JSON.stringify(row))
expect(row.strip.length === 1 && Math.round(row.strip[0].left) === Math.round(2 * row.cell) && Math.round(row.strip[0].width) === Math.round(2 * row.cell) && row.strip[0].title === 'open',
  `Animate: the part's row does not mark frames 3–4 as "open": ${JSON.stringify(row.strip)}`)
expect(row.label === 'open', `Animate: the part's label says ${row.label} at frame 3`)
await shot('animate-keyed')

// the diamond beside the picker removes the key again
await page.locator('.transport__variant + .key-badge').click()
await page.waitForTimeout(200)
const left = await page.evaluate(({ partId }) => { const s = window.__editorStore.getState(); return s.doc.animations[s.ui.animId].partTracks[partId]?.variant.length ?? 0 }, ids)
expect(left === 0, `Animate: the diamond left ${left} variant key(s)`)
expect(await seen(...INSIDE) === 'green', 'Animate: with the key gone the frame does not show the default')
await shot('animate-unkeyed')

await finish()
