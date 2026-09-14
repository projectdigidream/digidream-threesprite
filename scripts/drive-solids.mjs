#!/usr/bin/env node
/**
 * Builds a small character out of solids through the UI, drags one shape in
 * the side view, then screenshots the studio (all views) and the rig.
 *   pnpm dev &   then   node scripts/drive-solids.mjs [outDir] [--mobile]
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
page.on('dialog', d => d.accept())

let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

// Start from a fresh project so the library's last project does not interfere.
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  if (window.__createProject) s.loadProject(window.__createProject({ name: 'Solids drive', canvasSize: 64, viewCount: 8, mirror: false }))
})
await page.waitForTimeout(200)

if (mobile) {
  await page.locator('button[title="Solids"]').click()
}
await page.waitForSelector('.panel:has-text("Solids")', { timeout: 5000 })

// The panel's explanatory prose is desktop-only (the phone sheet is short).
const solidsPanel = page.locator('.panel:has-text("Solids")')
const hintShown = async (text) => (await solidsPanel.locator(`text=${text}`).count()) > 0
const wantHint = async (text, where) => {
  const shown = await hintShown(text)
  if (shown === mobile) errors.push(`${where} hint ${shown ? 'shown' : 'missing'} on ${mobile ? 'mobile' : 'desktop'}`)
  else console.log(`hint ${shown ? 'shown' : 'hidden'} as expected on ${mobile ? 'mobile' : 'desktop'}: ${where}`)
}
await wantHint('Build the character out of 3D shapes', 'empty-state')

await page.locator('.panel:has-text("Solids") button:has-text("Add a solids part")').click()
await page.waitForTimeout(200)
await page.locator('.solids__add button:has-text("Cube")').click()
await page.locator('.solids__add button:has-text("Sphere")').click()
await page.waitForTimeout(200)

// Shape the character through the store: body cube, head sphere, an arm cylinder to the character's right
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const partId = s.ui.selectedPartId
  const part = s.doc.parts[partId]
  const [cube, sphere] = part.solids.order
  s.commit('shape', d => {
    const g = d.parts[partId].solids
    Object.assign(g.primitives[cube], { position: { r: 0, u: 14, f: 0 }, size: { r: 14, u: 20, f: 8 }, color: [89, 125, 206, 255] })
    Object.assign(g.primitives[sphere], { position: { r: 0, u: 30, f: 0 }, size: { r: 12, u: 12, f: 12 }, color: [210, 170, 153, 255] })
  })
})
await page.locator('.solids__add button:has-text("Cylinder")').click()
await page.waitForTimeout(100)
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const partId = s.ui.selectedPartId
  const part = s.doc.parts[partId]
  const cyl = part.solids.order[2]
  s.commit('arm', d => {
    const g = d.parts[partId].solids
    Object.assign(g.primitives[cyl], { position: { r: 11, u: 16, f: 0 }, size: { r: 5, u: 18, f: 5 }, color: [208, 70, 72, 255] })
  })
})
await page.waitForTimeout(200)
await wantHint("Positions are in the bone's frame", 'primitive-fields')
await shot('solids-front')

// Side view (view 3): the arm should point at the camera; drag it forward with the Move tool
const tabs = page.locator('.view-tab')
await tabs.nth(2).click()
await page.waitForTimeout(150)
await shot('solids-side')
const canvas = page.locator('.pixel-canvas__surface').first()
const box = await canvas.boundingBox()
const before = await page.evaluate(() => { const s = window.__editorStore.getState(); const p = s.doc.parts[s.ui.selectedPartId]; return { ...p.solids.primitives[s.ui.selectedPrimitiveId].position } })
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(150)
const after = await page.evaluate(() => { const s = window.__editorStore.getState(); const p = s.doc.parts[s.ui.selectedPartId]; return { ...p.solids.primitives[s.ui.selectedPrimitiveId].position } })
console.log('arm position', JSON.stringify(before), '→', JSON.stringify(after))
if (after.f === before.f) errors.push('side-view drag did not move the solid forward/back')
await shot('solids-side-dragged')
await tabs.nth(0).click()

// Studio: all views + 3D
await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.waitForTimeout(1200)
await shot('studio')
const spread = page.locator('label:has-text("Spread") input')
if (await spread.count()) { await spread.first().click(); await page.waitForTimeout(900); await shot('studio-spread') }

// Rig: yaw the body bone 90° at frame 2 and look at the animate tab
await page.locator('.tab:has-text("Animate")').first().click()
await page.waitForTimeout(200)
const cells = page.locator('.timeline__hcell')
if (await cells.count() >= 3) {
  await cells.nth(2).click()
  const yaw = page.locator('.numfield:has-text("Rot yaw") input').first()
  await yaw.fill('90')
  await yaw.press('Enter')
  await page.waitForTimeout(200)
  await shot('animate-yaw')
}

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
