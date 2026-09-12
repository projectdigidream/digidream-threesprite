#!/usr/bin/env node
/**
 * The in-app dialogs: delete the only animation, add a new one from the
 * timeline's empty state, rename a part. Native prompt/confirm are blocked
 * here (they would auto-dismiss) to mimic the Tauri webviews.
 *   pnpm dev &   then   node scripts/drive-dialogs.mjs [outDir]
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
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
// any native dialog is a bug now
page.on('dialog', d => { errors.push(`native dialog opened: ${d.type()} "${d.message()}"`); d.dismiss() })
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }
const state = () => page.evaluate(() => { const s = window.__editorStore.getState(); return { anims: s.doc.animationOrder.map(id => s.doc.animations[id].name), parts: s.doc.partOrder.map(id => s.doc.parts[id].name), animId: s.ui.animId } })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ name: 'Dialogs drive' })))
await page.waitForTimeout(200)

// Animate tab: delete the only animation through the in-app confirm
await page.locator('.tab:has-text("Animate")').first().click()
await page.waitForSelector('.transport')
await page.locator('.transport button[title="Delete animation"]').click()
await page.waitForSelector('.modal--small')
await shot('confirm-delete')
await page.locator('.modal--small button.danger').click()
await page.waitForTimeout(150)
let st = await state()
console.log('after delete:', JSON.stringify(st))
if (st.anims.length !== 0) errors.push('animation was not deleted')

// Empty state → Add animation → in-app prompt → Enter
await page.waitForSelector('.timeline__empty')
await shot('empty-state')
await page.locator('.timeline__empty button').click()
await page.waitForSelector('.modal--small input')
await page.locator('.modal--small input').fill('walk')
await page.keyboard.press('Enter')
await page.waitForTimeout(150)
st = await state()
console.log('after add:', JSON.stringify(st))
if (st.anims.length !== 1 || st.anims[0] !== 'walk') errors.push('animation was not added from the empty state')
if (!st.animId) errors.push('new animation not selected')
await shot('after-add')

// the "+" in the transport works too, and Escape cancels
await page.locator('.transport button[title="Add animation"]').click()
await page.waitForSelector('.modal--small input')
await page.keyboard.press('Escape')
await page.waitForTimeout(100)
st = await state()
if (st.anims.length !== 1) errors.push('Escape did not cancel the prompt')

// Draw tab: rename the part via double-click
await page.locator('.tab:has-text("Draw")').first().click()
await page.locator('.part-list .row').first().dblclick()
await page.waitForSelector('.modal--small input')
await page.locator('.modal--small input').fill('torso')
await page.locator('.modal--small button.primary').click()
await page.waitForTimeout(150)
st = await state()
console.log('after rename:', JSON.stringify(st))
if (st.parts[0] !== 'torso') errors.push('part rename did not apply')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
