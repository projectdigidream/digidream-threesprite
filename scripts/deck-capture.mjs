#!/usr/bin/env node
/**
 * Opens the user's real "Mainchar" project through the app's own Open flow
 * and captures clean screenshots of each tab for a presentation deck.
 * One-off script for building marketing/demo screenshots; not part of the
 * verification suite.
 */
import { chromium } from 'playwright-core'
import { join } from 'node:path'

const OUT = process.argv[2]
const PROJECT_FILE = '~/Library/Application Support/com.digidream.threesprite/projects/A0LhsEcd3YLg.tsprite'
const url = 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('dialog', d => d.accept())

const shot = async (name, clip) => { const p = join(OUT, `${name}.png`); await page.screenshot({ path: p, clip }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

// Open the real project via the app's own Open flow (file input in the browser build)
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

await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.setUi({ selection: null, mode: 'draw' })
})
await page.waitForTimeout(200)
await shot('01-draw')

await page.locator('.tab:has-text("Rig")').first().click()
await page.waitForTimeout(250)
await shot('02-rig')

await page.locator('.tab:has-text("Animate")').first().click()
await page.waitForTimeout(250)
await page.evaluate(() => window.__editorStore.getState().setUi({ frame: 6 }))
await page.waitForTimeout(150)
await shot('03-animate')

await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.evaluate(() => window.__editorStore.getState().setUi({ showArrows: false, spread: false, playing: false }))
await page.waitForTimeout(1000)
await shot('04-studio-single')

await page.evaluate(() => window.__editorStore.getState().setUi({ spread: true, showArrows: false }))
await page.waitForTimeout(1200)
await shot('05-studio-spread')

await page.evaluate(() => window.__editorStore.getState().setUi({ spread: false, playing: true }))
await page.waitForTimeout(600)
await shot('06-studio-playing')
await page.evaluate(() => window.__editorStore.getState().setUi({ playing: false }))

await page.locator('.tab:has-text("Export")').first().click()
await page.waitForTimeout(250)
await page.locator('.export__format:has-text("PNG frames")').click()
await page.waitForTimeout(200)
await shot('07-export')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('done')
