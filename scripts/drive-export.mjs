#!/usr/bin/env node
/**
 * Drives the export panel, the project menu, and a browser save/reload cycle.
 *   pnpm dev &   then   node scripts/drive-export.mjs [outDir] [--mobile]
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
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
page.on('dialog', d => d.accept())

let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

// draw something so the export has content
const canvas = page.locator('.pixel-canvas__surface').first()
const box = await canvas.boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
await page.mouse.move(cx - 30, cy + 60); await page.mouse.down()
for (let i = 1; i <= 20; i++) await page.mouse.move(cx - 30 + i * 3, cy + 60 - i * 6)
await page.mouse.up()

// Export tab
await page.locator('.tab:has-text("Export")').first().click()
await page.waitForSelector('.export', { timeout: 5000 })
await shot('export-doom')
await page.locator('.export__format:has-text("PNG frames")').click()
await page.waitForTimeout(100)
await shot('export-pngs')
// browser download of the pngs zip
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.locator('.export__actions button.primary').click(),
])
console.log('downloaded', download.suggestedFilename())
await page.waitForTimeout(300)
await shot('export-report')

// Project menu: save to the library, then reload and expect the project to be reopened
await page.locator('button[aria-label="Project menu"]').click()
await page.waitForSelector('.menu')
await shot('menu')
await page.locator('.menu__item:has-text("Save")').first().click()
await page.waitForTimeout(400)
const before = await page.evaluate(() => { const s = window.__editorStore.getState(); return { id: s.doc.id, dirty: s.dirty } })
console.log('after save', JSON.stringify(before))
if (before.dirty) errors.push('document still dirty after save')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(800)
const after = await page.evaluate(() => { const s = window.__editorStore.getState(); return { id: s.doc.id, name: s.doc.name } })
console.log('after reload', JSON.stringify(after))
if (after.id !== before.id) errors.push(`reload did not reopen the saved project (${after.id} vs ${before.id})`)
await shot('after-reload')
await page.locator('button[aria-label="Project menu"]').click()
await page.waitForSelector('.menu')
await shot('menu-recent')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
