#!/usr/bin/env node
/**
 * Drives the depth-scaling setting: a skinned arm whose forearm swings its
 * tip at the viewer, measured on the real canvas with the setting off and
 * then on, set through the Project settings dialog.
 *   pnpm dev &   then   node scripts/drive-depth.mjs [outDir]
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

// An arm skinned across two bones. The forearm alone travels 18 px towards the
// camera over four frames, so at the flat projection nothing changes at all.
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.loadProject(window.__createProject({ name: 'Depth drive', canvasSize: 64, viewCount: 8, mirror: true, starter: false }))
  s.commit('build arm', d => {
    const bone = (opts) => { const b = { id: opts.name, name: opts.name, parentId: opts.parentId ?? null, children: [], length: opts.length, rest: { position: { r: 0, u: opts.u ?? 0, f: 0 }, rotation: { r: 0, u: 0, f: 0 } } }; d.skeleton.bones[b.id] = b; if (b.parentId) d.skeleton.bones[b.parentId].children.push(b.id); else d.skeleton.rootOrder.push(b.id); return b }
    const upper = bone({ name: 'upper', length: 20 })
    const fore = bone({ name: 'fore', parentId: upper.id, u: 20, length: 20 })
    const w = 10, h = 40
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const c = Math.floor(y / 4) % 2 === 0 ? [210, 125, 44] : [222, 238, 214]
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255
    }
    const vid = 'v1'
    d.parts.arm = { id: 'arm', name: 'arm', boneId: upper.id, offset: { x: 0, y: 0 }, rotation: -90, pivot: { x: 5, y: 40 }, foreshorten: true, variants: { [vid]: { id: vid, name: 'default', images: { 1: { width: w, height: h, pixels: px } } } }, variantOrder: [vid], defaultVariant: vid, skin: { bones: [fore.id], falloff: 12, cell: 4 } }
    d.partOrder.push('arm')
    const anim = { id: 'reach', name: 'reach', fps: 8, loop: true, frameCount: 4, boneTracks: {}, partTracks: {} }
    anim.boneTracks[fore.id] = { rotation: [{ frame: 0, value: { r: 0, u: 0, f: 0 }, interp: 'linear' }, { frame: 3, value: { r: -70, u: 0, f: 0 }, interp: 'linear' }], translate: [], scale: [] }
    d.animations.reach = anim
    d.animationOrder.push('reach')
  })
  s.setUi({ mode: 'animate', animId: 'reach', frame: 0, view: 1, grid: false, selectedPartId: 'arm' })
})
await page.waitForTimeout(300)

/** Bounding box of the part's own two colours on the canvas, so overlays do not count. */
const measure = async (frame) => {
  await page.evaluate(f => window.__editorStore.getState().setUi({ frame: f }), frame)
  await page.waitForTimeout(200)
  return page.evaluate(() => {
    const cv = document.querySelector('.pixel-canvas__surface')
    const g = cv.getContext('2d')
    const { data, width, height } = g.getImageData(0, 0, cv.width, cv.height)
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const near = (r, gr, b) => Math.abs(data[i] - r) < 24 && Math.abs(data[i + 1] - gr) < 24 && Math.abs(data[i + 2] - b) < 24
      if (data[i + 3] > 200 && (near(210, 125, 44) || near(222, 238, 214))) {
        if (x < x0) x0 = x; if (x > x1) x1 = x
        if (y < y0) y0 = y; if (y > y1) y1 = y
      }
    }
    return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1, bottom: y1 }
  })
}

const flatRest = await measure(0)
await shot('flat-rest')
const flatReach = await measure(3)
await shot('flat-reach')
console.log('flat  rest', JSON.stringify(flatRest), 'reach', JSON.stringify(flatReach))

// Set the camera distance through the dialog the artist would use.
await page.locator('[aria-label="Project settings"]').first().click()
await page.waitForSelector('[aria-label="Project settings"][role="dialog"]', { timeout: 5000 })
const field = page.locator('.field:has-text("Depth scaling") input')
await field.fill('4')
await shot('settings-dialog')
await page.locator('.modal__actions button.primary').click()
await page.waitForTimeout(300)
const distance = await page.evaluate(() => window.__editorStore.getState().doc.views.depthScale)
console.log('depth scaling now', distance)

const deepRest = await measure(0)
await shot('deep-rest')
const deepReach = await measure(3)
await shot('deep-reach')
console.log('deep  rest', JSON.stringify(deepRest), 'reach', JSON.stringify(deepReach))

await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.waitForTimeout(1200)
await shot('studio-reach')

await browser.close()

const fail = []
if (distance !== 4) fail.push(`the dialog did not apply the strength (got ${distance})`)
if (!flatRest || !flatReach || !deepRest || !deepReach) fail.push('the arm was not found on the canvas')
else {
  if (flatReach.w !== flatRest.w) fail.push('the flat projection changed width with depth')
  if (deepRest.w !== flatRest.w || deepRest.h !== flatRest.h) fail.push('the rest pose changed when the distance was set')
  if (!(deepReach.w > deepRest.w)) fail.push(`reaching forward did not widen the arm (${deepRest.w} → ${deepReach.w})`)
  if (Math.abs(deepReach.bottom - deepRest.bottom) > 2) fail.push('the shoulder end drifted')
}
if (errors.length) fail.push('page errors:\n' + errors.join('\n'))
if (fail.length) { console.error('FAILED:\n' + fail.join('\n')); process.exit(1) }
console.log(`ok: flat ${flatRest.w} wide whatever the depth; at strength 4 the swing grew ${deepRest.w}×${deepRest.h} → ${deepReach.w}×${deepReach.h}`)
