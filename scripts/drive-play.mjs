#!/usr/bin/env node
/**
 * Playback in the studio: keys a rotation, presses play in the 3D tab,
 * checks that frames advance and that the view canvases animate, then taps a
 * canvas to pause.
 *   pnpm dev &   then   node scripts/drive-play.mjs [outDir] [--mobile]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mobile = args.includes('--mobile')
const outDir = args.find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext(mobile
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

// fresh starter project, draw a mark, key a 90° roll at frame 3 so frames differ
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.loadProject(window.__createProject({ name: 'Play drive', canvasSize: 64, viewCount: 8, mirror: true }))
})
await page.waitForTimeout(200)
const canvas = page.locator('.pixel-canvas__surface').first()
const box = await canvas.boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
await page.mouse.move(cx, cy + 100); await page.mouse.down()
for (let i = 1; i <= 25; i++) await page.mouse.move(cx + i * 2, cy + 100 - i * 8)
await page.mouse.up()
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const bone = s.doc.skeleton.rootOrder[0]
  const animId = s.doc.animationOrder[0]
  s.commit('key', d => {
    const a = d.animations[animId]
    a.boneTracks[bone] = { rotation: [{ frame: 0, value: { r: 0, u: 0, f: 0 }, interp: 'linear' }, { frame: 3, value: { r: 0, u: 0, f: 60 }, interp: 'linear' }], translate: [], scale: [] }
  })
})

await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.waitForTimeout(800)
await shot('studio-paused')
await page.locator('.preview3d__bar button[title^="Play"]').click()
const frames = new Set()
for (let i = 0; i < 12; i++) {
  frames.add(await page.evaluate(() => window.__editorStore.getState().ui.frame))
  await page.waitForTimeout(90)
}
const playing = await page.evaluate(() => window.__editorStore.getState().ui.playing)
console.log('frames seen while playing:', [...frames].join(','), 'playing =', playing)
if (frames.size < 2) errors.push('frames did not advance while playing in the 3D tab')
if (!playing) errors.push('playback stopped by itself')
await shot('studio-playing')

// tap a view canvas (or the studio canvas on phones): pauses
const target = mobile ? page.locator('.studio-mobile__2d .pixel-canvas__surface').first() : page.locator('.view-grid .pixel-canvas__surface').first()
const tb = await target.boundingBox()
await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2)
await page.waitForTimeout(150)
const afterTap = await page.evaluate(() => window.__editorStore.getState().ui.playing)
console.log('playing after tapping a canvas =', afterTap)
if (afterTap) errors.push('tapping a canvas did not pause')
await shot('studio-paused-by-tap')

// scrubber
if (!mobile) {
  const scrub = page.locator('.preview3d__scrub')
  if (await scrub.count()) {
    await scrub.fill('2')
    const f = await page.evaluate(() => window.__editorStore.getState().ui.frame)
    console.log('scrubbed to frame', f)
    if (f !== 2) errors.push('scrubber did not set the frame')
  }
}

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
