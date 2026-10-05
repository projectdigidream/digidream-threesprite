#!/usr/bin/env node
/**
 * Drives the solids part on a phone: no banner sits over the canvas any more,
 * and a tap that cannot do anything says why for a moment and then gets out of
 * the way. Checked upright and sideways.
 *   pnpm dev &   then   node scripts/drive-solids-hint.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
const fail = []

for (const [name, viewport] of [['portrait', { width: 412, height: 915 }], ['landscape', { width: 915, height: 412 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${name} console: ${m.text()}`) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.waitForTimeout(400)

  // a part built from one cube, exactly as the Solids panel makes it
  await page.evaluate(() => {
    const s = window.__editorStore.getState()
    s.loadProject(window.__createProject({ name: 'Solids', canvasSize: 64, viewCount: 8, mirror: true, starter: false }))
    s.commit('solids part', d => {
      d.skeleton.bones.body = { id: 'body', name: 'body', parentId: null, children: [], length: 20, rest: { position: { r: 0, u: 0, f: 0 }, rotation: { r: 0, u: 0, f: 0 } } }
      d.skeleton.rootOrder.push('body')
      const prim = { id: 'cube1', name: 'cube', kind: 'cube', visible: true, color: [200, 90, 60, 255], position: { r: 0, u: 10, f: 0 }, size: { r: 16, u: 16, f: 16 }, rotation: { r: 0, u: 0, f: 0 } }
      d.parts.solids = {
        id: 'solids', name: 'solids', boneId: 'body', offset: { x: 0, y: 0 }, rotation: 0, pivot: { x: 0, y: 0 }, foreshorten: true,
        variants: { v: { id: 'v', name: 'default', images: {} } }, variantOrder: ['v'], defaultVariant: 'v',
        solids: { primitives: { cube1: prim }, order: ['cube1'], shading: { levels: 3, outline: true, lightSpace: 'view' } },
      }
      d.partOrder.push('solids')
    })
    s.setUi({ mode: 'draw', view: 1, selectedPartId: 'solids', tool: 'pencil' })
  })
  await page.waitForTimeout(400)

  const banners = async () => page.evaluate(() => [...document.querySelectorAll('.pixel-canvas__banner')].map(el => {
    const b = el.getBoundingClientRect()
    return { text: el.textContent.trim().slice(0, 60), h: Math.round(b.height), w: Math.round(b.width) }
  }))

  const atRest = await banners()
  await page.screenshot({ path: join(outDir, `${name}-1-clear.png`) })
  if (atRest.length) fail.push(`${name}: ${atRest.length} banner(s) sitting over the canvas: ${JSON.stringify(atRest)}`)

  // tap the canvas with the pencil, which a solids part cannot take
  const box = await page.locator('.pixel-canvas__surface').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(200)
  const flashed = await banners()
  await page.screenshot({ path: join(outDir, `${name}-2-hint.png`) })
  const canvasH = Math.round(box.height)
  console.log(`${name}: canvas ${Math.round(box.width)}×${canvasH} · at rest ${atRest.length} banner(s) · after a tap ${JSON.stringify(flashed)}`)
  if (flashed.length !== 1) fail.push(`${name}: expected one hint after the tap, got ${flashed.length}`)
  else {
    if (!/Move tool/.test(flashed[0].text)) fail.push(`${name}: the hint reads "${flashed[0].text}"`)
    if (flashed[0].h > canvasH * 0.2) fail.push(`${name}: the hint is ${flashed[0].h}px of a ${canvasH}px canvas`)
  }

  await page.waitForTimeout(2800)
  const gone = await banners()
  await page.screenshot({ path: join(outDir, `${name}-3-gone.png`) })
  if (gone.length) fail.push(`${name}: the hint stayed: ${JSON.stringify(gone)}`)

  // with the Move tool and a shape picked, the drag works and says nothing
  await page.evaluate(() => window.__editorStore.getState().setUi({ tool: 'move', selectedPrimitiveId: 'cube1' }))
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const afterDrag = await banners()
  const moved = await page.evaluate(() => window.__editorStore.getState().doc.parts.solids.solids.primitives.cube1.position.r)
  console.log(`${name}: dragging the cube moved it to r=${Math.round(moved)} with ${afterDrag.length} banner(s)`)
  if (afterDrag.length) fail.push(`${name}: a banner appeared on a drag that worked: ${JSON.stringify(afterDrag)}`)
  if (!(Math.abs(moved) > 1)) fail.push(`${name}: the cube did not move (r=${moved})`)
  await ctx.close()
}

await browser.close()
if (errors.length) fail.push('page errors:\n' + errors.join('\n'))
if (fail.length) { console.error('FAILED:\n' + fail.join('\n')); process.exit(1) }
console.log('ok: the canvas is clear, a tap that cannot work says why for a moment, a drag that works says nothing')
