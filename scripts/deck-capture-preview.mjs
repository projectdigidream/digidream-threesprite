#!/usr/bin/env node
/**
 * Re-captures the two "Preview" slide screenshots so they are genuinely
 * distinct: one orbited to a 3/4 angle (static), one reset to the front view
 * mid-stride while the animation plays.
 */
import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { homedir } from 'node:os'

const OUT = process.argv[2]
const PROJECT_FILE = (process.env.TSPRITE_PROJECT ?? join(homedir(), 'Library/Application Support/com.digidream.threesprite/projects/A0LhsEcd3YLg.tsprite'))
const url = 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('dialog', d => d.accept())

const shot = async (name) => { const p = join(OUT, `${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

await page.locator('button[aria-label="Project menu"]').click()
await page.waitForSelector('.menu')
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('.menu__item:has-text("Open")').click(),
])
await chooser.setFiles(PROJECT_FILE)
await page.waitForTimeout(600)
const loaded = await page.evaluate(() => window.__editorStore.getState().doc.name)
console.log('loaded project:', loaded)
if (loaded !== 'Mainchar') { console.error('did not load Mainchar'); process.exit(1) }

await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.evaluate(() => window.__editorStore.getState().setUi({ showArrows: false, spread: false, playing: false, frame: 6 }))
await page.waitForTimeout(500)

// Orbit to a clearly different, 3/4-ish angle by dragging on the 3D canvas.
const box = await page.locator('.preview3d__canvas').boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + 260, box.y + box.height / 2 - 40, { steps: 18 })
await page.mouse.up()
await page.waitForTimeout(500)
await shot('04-studio-single')

// Reset the camera back to the default front angle, then play from a frame
// that lands somewhere clearly different in the cycle.
await page.locator('.preview3d__bar button[title="Reset camera"]').click()
await page.waitForTimeout(300)
await page.evaluate(() => window.__editorStore.getState().setUi({ frame: 20, playing: true }))
await page.waitForTimeout(700)
const frameNow = await page.evaluate(() => window.__editorStore.getState().ui.frame)
console.log('playing frame at capture:', frameNow)
await shot('06-studio-playing')
await page.evaluate(() => window.__editorStore.getState().setUi({ playing: false }))

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('done')
