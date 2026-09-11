#!/usr/bin/env node
/**
 * Builds a two-bone arm with one skinned image through the store, keys a bend
 * and a stretch, and screenshots the animate canvas and the studio.
 *   pnpm dev &   then   node scripts/drive-skin.mjs [outDir]
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

// Build: upper arm bone (up from the feet), forearm bone on top; one striped 10×40 image spanning both, skinned to both.
const info = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.loadProject(window.__createProject({ name: 'Skin drive', canvasSize: 64, viewCount: 8, mirror: true, starter: false }))
  let ids = {}
  s.commit('build arm', d => {
    const bone = (opts) => { const b = { id: crypto.randomUUID().slice(0, 12), name: opts.name, parentId: opts.parentId ?? null, children: [], length: opts.length, rest: { position: { r: 0, u: opts.u ?? 0, f: 0 }, rotation: { r: 0, u: 0, f: 0 } } }; d.skeleton.bones[b.id] = b; if (b.parentId) d.skeleton.bones[b.parentId].children.push(b.id); else d.skeleton.rootOrder.push(b.id); return b }
    const upper = bone({ name: 'upper', length: 20 })
    const fore = bone({ name: 'fore', parentId: upper.id, u: 20, length: 20 })
    const w = 10, h = 40
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const stripe = Math.floor(y / 4) % 2 === 0
      const edge = x === 0 || x === w - 1
      const c = edge ? [20, 12, 28] : stripe ? [210, 125, 44] : [222, 238, 214]
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255
    }
    const vid = 'v1'
    const part = { id: 'arm', name: 'arm', boneId: upper.id, offset: { x: 0, y: 0 }, rotation: -90, pivot: { x: 5, y: 40 }, foreshorten: true, variants: { [vid]: { id: vid, name: 'default', images: { 1: { width: w, height: h, pixels: px } } } }, variantOrder: [vid], defaultVariant: vid, skin: { bones: [fore.id], falloff: 12, cell: 4 } }
    d.parts[part.id] = part
    d.partOrder.push(part.id)
    const anim = { id: 'bend', name: 'bend', fps: 8, loop: true, frameCount: 4, boneTracks: {}, partTracks: {} }
    anim.boneTracks[fore.id] = { rotation: [{ frame: 0, value: { r: 0, u: 0, f: 0 }, interp: 'linear' }, { frame: 2, value: { r: 0, u: 0, f: -90 }, interp: 'linear' }], translate: [{ frame: 0, value: { r: 0, u: 0, f: 0 }, interp: 'linear' }, { frame: 3, value: { r: 0, u: 10, f: 0 }, interp: 'linear' }], scale: [] }
    d.animations[anim.id] = anim
    d.animationOrder.push(anim.id)
    ids = { upper: upper.id, fore: fore.id }
  })
  s.setUi({ mode: 'animate', animId: 'bend', frame: 0, selectedBoneId: ids.fore, selectedPartId: 'arm' })
  return ids
})
console.log('bones', JSON.stringify(info))
await page.waitForTimeout(300)
await shot('animate-rest')
for (const f of [1, 2, 3]) {
  await page.evaluate(fr => window.__editorStore.getState().setUi({ frame: fr }), f)
  await page.waitForTimeout(150)
  await shot(`animate-frame-${f + 1}`)
}
// Rig inspector shows the skin controls
await page.locator('.tab:has-text("Rig")').first().click()
await page.waitForTimeout(200)
await shot('rig-skin-controls')
// Studio spread with the bend playing at frame 3
await page.evaluate(() => window.__editorStore.getState().setUi({ frame: 2, spread: true }))
await page.locator('.tab:has-text("3D")').first().click()
await page.waitForSelector('.preview3d__canvas', { timeout: 10000 })
await page.waitForTimeout(1200)
await shot('studio-bent')

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('no page errors')
