#!/usr/bin/env node
/**
 * Drives the per-view layer order: two overlapping squares, one view given its
 * own stacking through the Parts panel, the others left alone.
 *   pnpm dev &   then   node scripts/drive-vieworder.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`console: ${m.text()}`) })
page.on('dialog', d => d.accept())
let n = 0
const shot = async (name) => { n++; const p = join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.screenshot({ path: p }); console.log('shot', p) }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)

// Two squares offset from each other on one bone, drawn in all four views.
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.loadProject(window.__createProject({ name: 'Order drive', canvasSize: 32, viewCount: 4, mirror: false, starter: false }))
  s.commit('build', d => {
    const bone = { id: 'body', name: 'body', parentId: null, children: [], length: 10, rest: { position: { r: 0, u: 0, f: 0 }, rotation: { r: 0, u: 0, f: 0 } } }
    d.skeleton.bones.body = bone
    d.skeleton.rootOrder.push('body')
    const square = (c) => {
      const px = new Uint8ClampedArray(12 * 12 * 4)
      for (let i = 0; i < 12 * 12; i++) { px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255 }
      return { width: 12, height: 12, pixels: px }
    }
    const part = (id, c, dx) => {
      const vid = `${id}-v`
      const images = {}
      for (let k = 1; k <= 4; k++) images[k] = square(c)
      d.parts[id] = { id, name: id, boneId: 'body', offset: { x: dx, y: 0 }, rotation: -90, pivot: { x: 6, y: 6 }, foreshorten: true, variants: { [vid]: { id: vid, name: 'default', images } }, variantOrder: [vid], defaultVariant: vid }
      d.partOrder.push(id)
    }
    part('red', [214, 62, 62], -3)
    part('blue', [62, 110, 214], 3)
  })
  s.setUi({ mode: 'draw', view: 1, selectedPartId: 'red', grid: false, ghostOthers: false })
})
await page.waitForTimeout(300)

/** Which part is on top where the two squares overlap, straight from the composed frame. */
const topAt = async (view) => {
  await page.evaluate(v => window.__editorStore.getState().setUi({ view: v }), view)
  await page.waitForTimeout(150)
  return page.evaluate(() => {
    const cv = document.querySelector('.pixel-canvas__surface')
    const g = cv.getContext('2d')
    const { data, width, height } = g.getImageData(0, 0, cv.width, cv.height)
    let red = 0, blue = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 200) continue
      if (data[i] > 180 && data[i + 2] < 100) red++
      else if (data[i + 2] > 180 && data[i] < 100) blue++
    }
    return { red, blue }
  })
}

const before = { v1: await topAt(1), v3: await topAt(3) }
await shot('view3-shared-order')

// Give view 3 its own order and send the blue square behind, there only.
await page.evaluate(v => window.__editorStore.getState().setUi({ view: v, selectedPartId: 'blue' }), 3)
await page.locator('[aria-label="Layer order scope"]').click()
await page.waitForTimeout(150)
const chip = await page.locator('[aria-label="Layer order scope"]').innerText()
await page.locator('.part-list__actions .icon-btn[title*="Send backward"]').click()
await page.waitForTimeout(200)
await shot('view3-own-order')

const after = { v1: await topAt(1), v3: await topAt(3) }
await shot('view1-untouched')

const state = await page.evaluate(() => {
  const d = window.__editorStore.getState().doc
  return { byView: d.partOrderByView, order: d.partOrder }
})
console.log('chip', JSON.stringify(chip), 'state', JSON.stringify(state))
console.log('before', JSON.stringify(before), 'after', JSON.stringify(after))

// the strip marks the view that stacks its own way
const marked = await page.locator('.view-tab.is-ordered').count()
await browser.close()

const fail = []
if (chip.trim() !== 'View 3') fail.push(`the chip should name the view, got ${JSON.stringify(chip)}`)
if (!state.byView['3'] || state.byView['3'].join() !== 'blue,red') fail.push(`view 3 order is ${JSON.stringify(state.byView['3'])}`)
if (state.order.join() !== 'red,blue') fail.push(`the project order changed to ${state.order.join()}`)
if (!(before.v3.blue > before.v1.blue * 0.9 && before.v3.blue > 0)) fail.push('the squares did not overlap to begin with')
if (!(after.v3.blue < before.v3.blue)) fail.push(`blue did not go behind in view 3 (${before.v3.blue} → ${after.v3.blue})`)
if (after.v1.blue !== before.v1.blue) fail.push(`view 1 changed too (${before.v1.blue} → ${after.v1.blue})`)
if (marked !== 1) fail.push(`the view strip marks ${marked} views, expected 1`)
if (errors.length) fail.push('page errors:\n' + errors.join('\n'))
if (fail.length) { console.error('FAILED:\n' + fail.join('\n')); process.exit(1) }
console.log(`ok: view 3 stacks its own way (blue ${before.v3.blue} → ${after.v3.blue} px on top), view 1 untouched at ${after.v1.blue}`)
