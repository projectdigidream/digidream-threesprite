#!/usr/bin/env node
/**
 * Browser check: moving a part to another bone from the Rig inspector must not
 * move the drawing. Draws a stroke, adds a second bone elsewhere with a
 * different rotation, reassigns the body part to it, and compares the Draw
 * tab's canvas pixels before and after (they must be identical).
 *
 *   pnpm dev &
 *   node scripts/drive-attach.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const expect = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); errors.push(msg) } }

const canvasPng = async () => {
  await page.locator('.tab:has-text("Draw")').first().click()
  await page.waitForTimeout(150)
  return page.locator('.pixel-canvas__surface').screenshot()
}

const failShot = async (e) => { try { await page.screenshot({ path: join(outDir, 'attach-FAIL.png') }) } catch {} ; const open = await page.locator('.modal').allInnerTexts().catch(() => []); console.error('open dialogs:', open); throw e }
process.on('unhandledRejection', failShot)

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.evaluate(() => window.__editorStore.getState().loadProject(window.__createProject({ name: 'Attach drive', canvasSize: 32, viewCount: 8 })))
await page.waitForTimeout(150)

// A recognisable drawing: a diagonal stroke.
const box = await page.locator('.pixel-canvas__surface').boundingBox()
const cx = box.x + box.width / 2, cy = box.y + box.height / 2
await page.mouse.move(cx - 80, cy - 80)
await page.mouse.down()
for (let i = 1; i <= 20; i++) await page.mouse.move(cx - 80 + i * 8, cy - 80 + i * 6)
await page.mouse.up()
await page.waitForTimeout(100)

// A second bone: somewhere else, rotated, so the two projected frames differ.
const ids = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  const id = 'boneB_' + Math.random().toString(36).slice(2, 8)
  s.commit('Add bone', d => {
    d.skeleton.bones[id] = { id, name: 'arm', parentId: null, children: [], length: 12, rest: { position: { r: 9, u: 17, f: 3 }, rotation: { r: 10, u: 25, f: 37 } } }
    d.skeleton.rootOrder.push(id)
  })
  return { partId: s.doc.partOrder[0], boneA: s.doc.partOrder[0] && s.doc.parts[s.doc.partOrder[0]].boneId, boneB: id }
})

const before = await canvasPng()
await page.locator('.pixel-canvas__surface').screenshot({ path: join(outDir, 'attach-before.png') })

// Rig tab → the part's bone dropdown → the new bone.
await page.locator('.tab:has-text("Rig")').first().click()
await page.waitForTimeout(150)
await page.evaluate(({ partId }) => window.__editorStore.getState().selectPart(partId), ids)
const select = page.locator('.inspector__body select.select').nth(1)
expect(await select.count() === 1, 'the part bone dropdown is shown')
await select.selectOption(ids.boneB)
await page.waitForTimeout(150)
await page.screenshot({ path: join(outDir, 'attach-rig-after.png') })
const st = await page.evaluate(({ partId }) => { const s = window.__editorStore.getState(); const p = s.doc.parts[partId]; return { boneId: p.boneId, offset: p.offset, rotation: p.rotation, undo: s.history.undo.map(h => h.label).slice(-1)[0] } }, ids)
expect(st.boneId === ids.boneB, `part is on the new bone (${st.boneId})`)
expect(st.undo === 'Attach part', `one "Attach part" undo step (${st.undo})`)
expect(!(st.offset.x === 0 && st.offset.y === 0), `offset was recomputed (${JSON.stringify(st.offset)}, rot ${st.rotation})`)

const after = await canvasPng()
await page.locator('.pixel-canvas__surface').screenshot({ path: join(outDir, 'attach-after.png') })
expect(before.equals(after), 'the drawing did not move when the part changed bone')

// Undo puts it back on the first bone and the drawing is still the same.
await page.evaluate(() => window.__editorStore.getState().undo())
const st2 = await page.evaluate(({ partId }) => window.__editorStore.getState().doc.parts[partId].boneId, ids)
expect(st2 === ids.boneA, 'undo restores the original bone')
expect(before.equals(await canvasPng()), 'the drawing is unchanged after undo')

// Deleting the new bone while the part hangs from it: the part re-hangs from the first root, still in place.
await page.evaluate(({ partId, boneB }) => { const s = window.__editorStore.getState(); s.redo(); s.setUi({ selectedBoneId: boneB, selectedPartId: partId }) }, ids)
await page.locator('.tab:has-text("Rig")').first().click()
await page.waitForTimeout(100)
await page.locator('button[title="Delete bone"]').click()
await page.waitForSelector('.modal--small')
await page.locator('.modal--small button:has-text("Delete")').click()
await page.waitForTimeout(150)
const st3 = await page.evaluate(({ partId }) => { const s = window.__editorStore.getState(); return { boneId: s.doc.parts[partId].boneId, bones: Object.keys(s.doc.skeleton.bones).length } }, ids)
expect(st3.bones === 1 && st3.boneId === ids.boneA, `bone deleted and part re-hung on the root (${JSON.stringify(st3)})`)
expect(before.equals(await canvasPng()), 'the drawing did not move when its bone was deleted')

await browser.close()
if (errors.length) { console.error(`\n${errors.length} problem(s)`); process.exit(1) }
console.log('attach drive ok')
