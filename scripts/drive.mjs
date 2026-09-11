#!/usr/bin/env node
/**
 * Browser-driven smoke check for the web build. Drives the installed Google
 * Chrome through playwright-core (no browser download), so it works on a
 * fresh clone with only Chrome present.
 *
 *   pnpm dev &                      # Vite on :1420
 *   node scripts/drive.mjs [outDir] [--mobile]
 *
 * Writes numbered screenshots into outDir (default: ./drive-out) and prints
 * console errors. Exit code 1 if the page threw.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mobile = args.includes('--mobile')
const outDir = args.find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext(mobile
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)
await shot('draw-initial')

// Draw a diagonal stroke on the canvas with the pencil.
const canvas = page.locator('.pixel-canvas__surface')
const box = await canvas.boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
await page.mouse.move(cx - 60, cy - 60)
await page.mouse.down()
for (let i = 1; i <= 20; i++) await page.mouse.move(cx - 60 + i * 6, cy - 60 + i * 6)
await page.mouse.up()
await page.waitForTimeout(100)
await shot('after-stroke')

// Switch colour via a palette swatch, fill.
const swatches = page.locator('.palette__grid .swatch')
if (await swatches.count() > 6) await swatches.nth(6).click()
await page.locator('button[aria-label="Fill"]').first().click()
await page.mouse.click(cx + 80, cy - 80)
await page.waitForTimeout(100)
await shot('after-fill')

// Undo twice, redo once.
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
await page.waitForTimeout(100)
await shot('after-undo-redo')

// Switch to view 3 (should be empty → banner), then to a derived view.
const tabs = page.locator('.view-tab')
if (await tabs.count() >= 8) {
  await tabs.nth(2).click(); await page.waitForTimeout(100); await shot('view-3')
  await tabs.nth(7).click(); await page.waitForTimeout(100); await shot('view-8-derived')
  await tabs.nth(0).click()
}

// Other modes
for (const m of ['Rig', 'Animate', '3D', 'Export']) {
  await page.locator(`.tab:has-text("${m}")`).first().click()
  await page.waitForTimeout(150)
  await shot(`mode-${m.toLowerCase()}`)
}

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
