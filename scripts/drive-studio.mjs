#!/usr/bin/env node
/**
 * Drives the rig, animate and studio (3D) modes and screenshots them.
 *   pnpm dev &   then   node scripts/drive-studio.mjs [outDir] [--mobile] [--landscape]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mobile = args.includes('--mobile')
const landscape = args.includes('--landscape')
const outDir = args.find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const viewport = mobile ? (landscape ? { width: 915, height: 412 } : { width: 412, height: 915 }) : { width: 1280, height: 800 }
const context = await browser.newContext(mobile
  ? { viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })

let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

// draw a simple figure: a filled block and a stroke so views have content
const canvas = page.locator('.pixel-canvas__surface').first()
const box = await canvas.boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
await page.mouse.move(cx - 40, cy + 100)
await page.mouse.down()
for (let i = 1; i <= 30; i++) await page.mouse.move(cx - 40 + i * 3, cy + 100 - i * 8)
await page.mouse.up()
await page.mouse.move(cx + 50, cy - 140)
await page.mouse.down()
for (let i = 1; i <= 20; i++) await page.mouse.move(cx + 50 - i * 5, cy - 140 + i * 2)
await page.mouse.up()
await page.waitForTimeout(100)

// Rig mode: drag the bone tip to rotate it
await page.locator('.tab:has-text("Rig")').first().click()
await page.waitForTimeout(200)
await shot('rig')
if (!mobile) {
  // Locate the starter bone's tip exactly through the dev-exposed store, drag it, and check the rest rotation changed.
  // The starter bone stands upright at the feet point: its tip projects to (size/2, size − length) in every view.
  const info = await page.evaluate(() => {
    const s = window.__editorStore.getState()
    const b = s.doc.skeleton.bones[s.doc.skeleton.rootOrder[0]]
    return { zoom: s.ui.zoom, pan: s.ui.pan, size: s.doc.canvas.size, len: b.length, rot: { ...b.rest.rotation } }
  })
  const c2 = await page.locator('.pixel-canvas__surface').first().boundingBox()
  const tip = { x: info.size / 2, y: info.size - info.len }
  const sx = c2.x + info.pan.x + tip.x * info.zoom
  const sy = c2.y + info.pan.y + tip.y * info.zoom
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 80, sy + 30, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => { const s = window.__editorStore.getState(); return { ...s.doc.skeleton.bones[s.doc.skeleton.rootOrder[0]].rest.rotation } })
  console.log(`bone rotation ${JSON.stringify(info.rot)} → ${JSON.stringify(after)}`)
  if (after.f === info.rot.f) errors.push('rig drag did not roll the bone in the front view')
  await shot('rig-after-rotate')
}

// Animate mode: key rotation at frame 3 via the inspector
await page.locator('.tab:has-text("Animate")').first().click()
await page.waitForTimeout(200)
await shot('animate')
const cells = page.locator('.timeline__hcell')
if (await cells.count() >= 4) {
  await cells.nth(3).click()
  const rot = page.locator('.numfield:has-text("Rot roll") input').first()
  await rot.fill('35')
  await rot.press('Enter')
  await page.waitForTimeout(150)
  await shot('animate-keyed')
}

// Studio / 3D
await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.waitForTimeout(1200)
await shot('studio')
// orbit a bit
const p3 = await page.locator('.preview3d__canvas').boundingBox()
await page.mouse.move(p3.x + p3.width / 2, p3.y + p3.height / 2)
await page.mouse.down()
await page.mouse.move(p3.x + p3.width / 2 + 220, p3.y + p3.height / 2 + 10, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(700)
await shot('studio-orbited')
// spread
const spread = page.locator('label:has-text("Spread") input')
if (await spread.count()) { await spread.first().click(); await page.waitForTimeout(900); await shot('studio-spread') }

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
