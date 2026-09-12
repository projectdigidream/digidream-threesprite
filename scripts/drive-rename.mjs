#!/usr/bin/env node
/**
 * Renaming parts in the Draw tab through the in-place name field: type + Enter,
 * type + blur, Escape reverts, double-click focuses; one undo step per rename.
 *   pnpm dev &   then   node scripts/drive-rename.mjs [outDir] [--mobile]
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
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
page.on('dialog', d => { errors.push(`native dialog: ${d.type()}`); d.dismiss() })
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }
const names = () => page.evaluate(() => { const s = window.__editorStore.getState(); return { parts: s.doc.partOrder.map(id => s.doc.parts[id].name), undo: s.history.undo.length } })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ name: 'Rename drive' })))
await page.waitForTimeout(200)
if (mobile) await page.locator('button[title="Parts"]').click()

const field = page.locator('.part-list .inline-name')
await field.waitFor()
await shot('parts-panel')
// type + Enter
await field.fill('torso')
await field.press('Enter')
await page.waitForTimeout(100)
let st = await names()
console.log('after Enter:', JSON.stringify(st))
if (st.parts[0] !== 'torso' || st.undo !== 1) errors.push('rename with Enter failed or made more than one undo step')
// type + blur
await field.fill('chest')
await page.locator('.panel__header').first().click()
await page.waitForTimeout(100)
st = await names()
console.log('after blur:', JSON.stringify(st))
if (st.parts[0] !== 'chest' || st.undo !== 2) errors.push('rename with blur failed')
// Escape reverts
await field.fill('nope')
await field.press('Escape')
await page.waitForTimeout(100)
st = await names()
if (st.parts[0] !== 'chest' || st.undo !== 2) errors.push('Escape did not revert')
// double-click a row focuses the field
if (!mobile) {
  await page.locator('.part-list .row').first().dblclick()
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('inline-name'))
  if (!focused) errors.push('double-click did not focus the name field')
}
await shot('renamed')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
