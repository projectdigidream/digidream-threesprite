#!/usr/bin/env node
/**
 * Timeline checks: with more rows than fit, every bone name must stay on its
 * own row while the grid scrolls; and one or several keyframes must copy and
 * paste (modifier-click on desktop, the multi-select toggle on touch).
 *
 *   pnpm dev &
 *   node scripts/drive-timeline.mjs [outDir] [--mobile]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mobile = args.includes('--mobile')
const outDir = args.find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const BONES = 14

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext(mobile
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const expect = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); errors.push(msg) } else console.log('ok:', msg) }

let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${mobile ? 'mobile' : 'desktop'}-${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })

// A rig with more rows than the timeline can show, each bone keyed at frame i % 5.
await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ name: 'Timeline drive', canvasSize: 16, viewCount: 4 })))
await page.evaluate((count) => {
  const s = window.__editorStore.getState()
  s.commit('rig', d => {
    const anim = d.animations[d.animationOrder[0]]
    anim.frameCount = 16
    for (let i = 0; i < count; i++) {
      const id = `bone${i}`
      d.skeleton.bones[id] = { id, name: `bone-${i}`, parentId: null, children: [], length: 8, rest: { position: { r: 0, u: i, f: 0 }, rotation: { r: 0, u: 0, f: 0 } } }
      d.skeleton.rootOrder.push(id)
      anim.boneTracks[id] = { rotation: [{ frame: i % 5, value: { r: 0, u: i * 5, f: 0 }, interp: 'linear' }], translate: [], scale: [] }
    }
  })
}, BONES)
await page.locator('.tab:has-text("Animate")').first().click()
await page.waitForSelector('.timeline__grid', { timeout: 10000 })
await page.waitForTimeout(200)

// ── row alignment ──────────────────────────────────────────────────────────
const labels = page.locator('.timeline__label')
const gridRows = page.locator('.timeline__row')
expect(await labels.count() === await gridRows.count(), `one label per grid row (${await labels.count()})`)

const offsets = async (idx) => {
  const l = await labels.nth(idx).boundingBox()
  const r = await gridRows.nth(idx).boundingBox()
  return Math.abs(l.y - r.y)
}
for (const i of [0, 5, 10]) expect(await offsets(i) < 1.5, `row ${i} label lines up before scrolling (${(await offsets(i)).toFixed(1)}px off)`)

const scrolled = await page.locator('.timeline__grid').evaluate(el => { el.scrollTop = 90; return el.scrollTop })
expect(scrolled > 0, `the grid scrolls vertically with ${BONES + 2} rows (scrollTop ${scrolled})`)
await page.waitForTimeout(120)
for (const i of [5, 10, 14]) expect(await offsets(i) < 1.5, `row ${i} label still lines up after scrolling (${(await offsets(i)).toFixed(1)}px off)`)
const labelScroll = await page.locator('.timeline__labels-scroll').evaluate(el => el.scrollTop)
expect(labelScroll === scrolled, `the name column followed the grid (${labelScroll} vs ${scrolled})`)
await shot('scrolled')

await page.locator('.timeline__grid').evaluate(el => { el.scrollTop = 0 })
await page.waitForTimeout(120)

// ── copy / paste ───────────────────────────────────────────────────────────
// bone0 and bone5 are rows 1 and 6, both keyed at frame 0.
const keyOf = (row) => gridRows.nth(row).locator('.timeline__key').first()
const state = () => page.evaluate(() => {
  const s = window.__editorStore.getState()
  const a = s.doc.animations[s.ui.animId]
  const frames = id => (a.boneTracks[id]?.rotation ?? []).map(k => k.frame).sort((x, y) => x - y)
  return { b0: frames('bone0'), b5: frames('bone5'), undo: s.history.undo.map(h => h.label).slice(-1)[0], frame: s.ui.frame }
})

if (mobile) {
  await page.locator('button[title^="Pick several keyframes"]').click()
  await keyOf(1).click()
  await keyOf(6).click()
} else {
  await keyOf(1).click()
  await keyOf(6).click({ modifiers: ['Shift'] })
}
expect(await page.locator('.timeline__key.is-selected').count() === 2, 'two keyframes selected')
await shot('selected')

await page.locator('button[title^="Copy 2 keyframes"]').click()
await page.locator('.timeline__hcell').nth(10).click()
expect((await state()).frame === 10, 'playhead moved to frame 11')
await page.locator('button[title^="Paste 2 keyframes"]').click()
await page.waitForTimeout(150)
let st = await state()
expect(st.b0.join() === '0,10' && st.b5.join() === '0,10', `both rows gained a key at frame 10 (${JSON.stringify(st)})`)
expect(st.undo === 'Paste keys', `one "Paste keys" undo step (${st.undo})`)
expect(await page.locator('.timeline__key.is-selected').count() === 2, 'the pasted keys are selected, ready to paste again')
await shot('pasted')

const pastedValue = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const t = s.doc.animations[s.ui.animId].boneTracks.bone5.rotation
  return t.find(k => k.frame === 10)?.value.u
})
expect(pastedValue === 25, `the pasted key carries its value (yaw ${pastedValue}, expected 25)`)

await page.evaluate(() => window.__editorStore.getState().undo())
await page.waitForTimeout(120)
st = await state()
expect(st.b0.join() === '0' && st.b5.join() === '0', `undo removes every pasted key (${JSON.stringify(st)})`)

// Spacing between copied frames survives: bone1 (frame 1) + bone2 (frame 2) → 12 and 13.
if (mobile) {
  await keyOf(2).click()
  await keyOf(3).click()
} else {
  await keyOf(2).click()
  await keyOf(3).click({ modifiers: [MOD] })
}
expect(await page.locator('.timeline__key.is-selected').count() === 2, 'two more keyframes selected')
await page.locator('button[title^="Copy 2 keyframes"]').click()
await page.locator('.timeline__hcell').nth(12).click()
await page.locator('button[title^="Paste 2 keyframes"]').click()
await page.waitForTimeout(150)
const spaced = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const a = s.doc.animations[s.ui.animId]
  const frames = id => (a.boneTracks[id]?.rotation ?? []).map(k => k.frame).sort((x, y) => x - y)
  return { b1: frames('bone1'), b2: frames('bone2') }
})
expect(spaced.b1.join() === '1,12' && spaced.b2.join() === '2,13', `the gap between copied frames survives (${JSON.stringify(spaced)})`)

// Keyboard shortcuts (desktop only).
if (!mobile) {
  await keyOf(4).click()
  await page.keyboard.press(`${MOD}+c`)
  await page.locator('.timeline__hcell').nth(15).click()
  await page.keyboard.press(`${MOD}+v`)
  await page.waitForTimeout(150)
  const kb = await page.evaluate(() => {
    const s = window.__editorStore.getState()
    return (s.doc.animations[s.ui.animId].boneTracks.bone3?.rotation ?? []).map(k => k.frame).sort((x, y) => x - y)
  })
  expect(kb.join() === '3,15', `⌘C / ⌘V copy and paste a keyframe (${kb})`)
}
await shot('done')

await browser.close()
if (errors.length) { console.error(`\n${errors.length} problem(s)`); process.exit(1) }
console.log('timeline drive ok')
