#!/usr/bin/env node
/**
 * Finger strokes through Chrome's own touch input (CDP touch events, so the
 * page sees real touch pointers), on the phone layout: a slow, careful stroke
 * paints, a quick one paints its whole line, and a finger held still on one
 * pixel picks its colour without painting. `--throttle N` slows the CPU N×,
 * like a cheap phone or an emulator.
 *   pnpm dev &   then   node scripts/drive-touch.mjs [outDir] [--throttle 6]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const ti = args.indexOf('--throttle')
const throttle = ti >= 0 ? Number(args[ti + 1]) : 1
const outDir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--throttle') ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(500)
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.loadProject(window.__createProject({ name: 'Touch', canvasSize: 32, viewCount: 1 }))
  s.setUi({ tool: 'pencil', primary: [255, 0, 0, 255], zoom: 8 })
})
await page.waitForTimeout(300)
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
const box = await page.locator('.pixel-canvas__surface').boundingBox()

const state = () => page.evaluate(() => {
  const s = window.__editorStore.getState(); const p = s.doc.parts[s.doc.partOrder[0]]
  const img = p.variants[p.defaultVariant].images[1]; let n = 0
  for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i]) n++
  return { painted: n, primary: s.ui.primary.join() }
})
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
/** A finger on the canvas: `steps` moves of `dx` css px, `ms` apart. */
async function finger(x0, y, steps, dx, ms) {
  await touch('touchStart', x0, y)
  for (let i = 1; i <= steps; i++) { await page.waitForTimeout(ms); await touch('touchMove', x0 + i * dx, y) }
  await touch('touchEnd', 0, 0)
  await page.waitForTimeout(300)
}

const s0 = await state()
// slow and careful: 1 css px every 60 ms, a sprite pixel every half second at zoom 8
await finger(box.x + 60, box.y + box.height / 2 - 80, 60, 1, 60)
const s1 = await state()
console.log(`slow stroke: ${s1.painted - s0.painted} px`)
if (s1.painted - s0.painted < 5) errors.push(`a slow stroke painted ${s1.painted - s0.painted} px, not the ~7 it crossed`)
// quick: 4 css px every 16 ms
await finger(box.x + 60, box.y + box.height / 2, 60, 4, 16)
const s2 = await state()
console.log(`quick stroke: ${s2.painted - s1.painted} px`)
if (s2.painted - s1.painted < 26) errors.push(`a quick stroke painted ${s2.painted - s1.painted} px, not the ~30 it crossed`)
await page.screenshot({ path: join(outDir, 'touch-strokes.png') })
// held still on the quick stroke's red line: picks red, paints nothing
await page.evaluate(() => window.__editorStore.getState().setUi({ primary: [0, 0, 255, 255] }))
await finger(box.x + 120, box.y + box.height / 2, 8, 0.4, 100)
const s3 = await state()
console.log(`held still: primary ${s3.primary}, painted ${s3.painted - s2.painted} px`)
if (s3.primary !== '255,0,0,255') errors.push(`holding a finger on red picked ${s3.primary}`)
if (s3.painted !== s2.painted) errors.push(`holding a finger still painted ${s3.painted - s2.painted} px`)

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log(`touch drive passed${throttle > 1 ? ` (CPU ${throttle}× slower)` : ''}`)
