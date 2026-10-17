#!/usr/bin/env node
/**
 * Autosave in the browser build, where every project lives in the library:
 * a new sprite survives a reload without ever being saved by hand, switching
 * to another project neither asks to discard nor loses the last stroke, and
 * editing without a pause still reaches the library.
 *   pnpm dev &   then   node scripts/drive-autosave.mjs [outDir] [--mobile]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const mobile = args.includes('--mobile')
const outDir = args.find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })
const context = await browser.newContext(mobile
  ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
let leavePrompts = 0
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
page.on('dialog', d => {
  if (d.type() === 'beforeunload') { leavePrompts++; d.accept(); return }
  errors.push(`native dialog: ${d.type()}`); d.dismiss()
})
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `autosave-${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

/** The open document, how much is painted in it, and any in-app question on screen. */
const state = () => page.evaluate(() => {
  const s = window.__editorStore.getState()
  let painted = 0
  for (const part of Object.values(s.doc.parts)) for (const v of Object.values(part.variants)) for (const img of Object.values(v.images)) {
    for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i]) painted++
  }
  const modal = document.querySelector('.modal-backdrop--top .modal')
  return { id: s.doc.id, name: s.doc.name, dirty: s.dirty, painted, title: document.title, question: modal?.getAttribute('aria-label') ?? null }
})
/** The library's recent list, straight out of IndexedDB. */
const recent = () => page.evaluate(() => new Promise((resolve, reject) => {
  const req = indexedDB.open('prspr-editor')
  req.onerror = () => reject(req.error)
  req.onsuccess = () => {
    const db = req.result
    if (!db.objectStoreNames.contains('meta')) { db.close(); resolve([]); return }
    const r = db.transaction('meta', 'readonly').objectStore('meta').get('recent')
    r.onsuccess = () => { db.close(); resolve((r.result ?? []).map(e => ({ id: e.id, name: e.name }))) }
    r.onerror = () => reject(r.error)
  }
}))
const ready = async () => {
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.waitForTimeout(800) // the launch reopen of the last project
}
const menu = async () => { await page.locator('button[aria-label="Project menu"]').click(); await page.locator('.menu').waitFor() }
const newSprite = async (name) => {
  await menu()
  await page.locator('.menu__item', { hasText: 'New project' }).click()
  const dlg = page.locator('.modal[aria-label="New project"]')
  await dlg.locator('input').first().fill(name)
  await dlg.locator('button.primary', { hasText: 'Create' }).click()
}
const paint = async (dx, dy) => {
  if (mobile) await page.locator('button[title="Draw"]').click().catch(() => {})
  const box = await page.locator('.pixel-canvas__surface').boundingBox()
  const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
}

await page.goto(url, { waitUntil: 'networkidle' })
await ready()

// 1. A new sprite, never saved by hand, is still there after a reload.
await newSprite('Autosave drive')
await page.waitForTimeout(200)
await paint(0, 0)
let st = await state()
if (st.painted < 1) errors.push(`the stroke painted nothing: ${JSON.stringify(st)}`)
const firstId = st.id
await page.waitForTimeout(2500)
st = await state()
console.log('after the pause:', JSON.stringify(st))
if (st.dirty) errors.push('still unsaved 2.5 s after the stroke')
if (st.title.includes('•')) errors.push(`the title still marks unsaved changes: ${st.title}`)
await shot('saved-itself')
const leaveBefore = leavePrompts
await page.reload({ waitUntil: 'networkidle' })
await ready()
st = await state()
console.log('after reload:', JSON.stringify(st))
if (leavePrompts > leaveBefore) errors.push('reloading after the autosave asked whether to leave the page')
if (st.id !== firstId || st.name !== 'Autosave drive') errors.push(`the reload opened "${st.name}", not the new sprite`)
if (st.painted < 1) errors.push('the stroke did not survive the reload')
if (st.question) errors.push(`the reload asked: ${st.question}`)
await shot('after-reload')

// 2. Switching to another project straight after a stroke: no "discard?", and the stroke is kept.
await paint(16, -16)
const paintedBefore = (await state()).painted
await newSprite('Second sprite')
await page.waitForTimeout(300)
st = await state()
if (st.question) {
  errors.push(`switching projects asked: ${st.question}`)
  await page.locator('.modal-backdrop--top .modal__actions button').last().click()
  await page.waitForTimeout(300)
  st = await state()
}
if (st.name !== 'Second sprite') errors.push(`New project did not switch: ${JSON.stringify(st)}`)
await menu()
await shot('recent-list')
const row = page.locator('.menu__recent-open', { hasText: 'Autosave drive' })
if (await row.count() === 0) {
  errors.push('the first sprite is not in Recent')
  await browser.close()
  console.error('ERRORS:\n' + errors.join('\n'))
  process.exit(1)
}
await row.click()
await page.waitForTimeout(500)
st = await state()
console.log('back to the first sprite:', JSON.stringify(st))
if (st.question) { errors.push(`reopening asked: ${st.question}`); await page.locator('.modal-backdrop--top .modal__actions button').last().click(); await page.waitForTimeout(300); st = await state() }
if (st.id !== firstId) errors.push(`Recent did not reopen the first sprite: ${JSON.stringify(st)}`)
if (st.painted !== paintedBefore) errors.push(`the first sprite came back with ${st.painted} painted pixels, not ${paintedBefore}: the last stroke was lost`)

// 3. Editing without a pause still reaches the library, at most every few seconds.
const t0 = Date.now()
let i = 0
let reached = null
while (Date.now() - t0 < 12000) {
  i++
  await page.evaluate(k => window.__editorStore.getState().commit('Rename', d => { d.name = `Stream ${k}` }), i)
  if (!reached) {
    const r = (await recent()).find(e => e.id === firstId)
    if (r && /^Stream /.test(r.name)) reached = { name: r.name, after: Date.now() - t0 }
  }
  await page.waitForTimeout(400)
}
console.log(`continuous edits: ${i} renames over 12 s; first reached the library:`, JSON.stringify(reached))
if (!reached) errors.push('12 s of edits without a pause never reached the library')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('autosave drive passed')
