#!/usr/bin/env node
/**
 * Drives the phone layout in both orientations: upright the panels stack under
 * the canvas, sideways they sit in a rail down the right-hand side. Checks the
 * geometry the browser actually laid out, in every mode.
 *   pnpm dev &   then   node scripts/drive-landscape.mjs [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv.slice(2).find(a => !a.startsWith('--')) ?? 'drive-out'
mkdirSync(outDir, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'

const PORTRAIT = { width: 412, height: 915 }
const LANDSCAPE = { width: 915, height: 412 }
const MODES = ['draw', 'rig', 'animate', 'preview', 'export']

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
const fail = []

/** Where the canvas and the panel rail ended up, in page coordinates. */
async function boxes(page) {
  return page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    }
    // upright the rail is `display: contents` and has no box of its own, so
    // the panels are measured where they actually landed
    const panels = [...document.querySelectorAll('.mobile__sheet, .mobile__strips')].map(el => {
      const b = el.getBoundingClientRect()
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
    })
    return {
      main: r('.mobile__main'), rail: r('.mobile__rail'), tabs: r('.tab-bar'), panels,
      studio3d: r('.studio-mobile__3d'), studio2d: r('.studio-mobile__2d'),
    }
  })
}

for (const [name, viewport] of [['portrait', PORTRAIT], ['landscape', LANDSCAPE]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name} pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${name} console: ${m.text()}`) })
  page.on('dialog', d => d.accept())
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.waitForTimeout(400)

  if (!(await page.locator('.mobile').count())) fail.push(`${name}: the phone layout did not kick in`)

  for (const mode of MODES) {
    await page.evaluate(m => window.__editorStore.getState().setUi({ mode: m }), mode)
    if (mode === 'draw') await page.locator('.icon-btn[title="Parts"]').click().catch(() => {})
    await page.waitForTimeout(250)
    const p = join(outDir, `${name}-${mode}.png`)
    await page.screenshot({ path: p })
    console.log('shot', p)
    const { main, rail, tabs, panels, studio3d, studio2d } = await boxes(page)
    if (mode === 'preview') {
      // the studio splits itself: stacked upright, side by side sideways
      if (!studio3d || !studio2d) { fail.push(`${name}/preview: no studio panes`); continue }
      console.log(` ${name}/preview 3d ${studio3d.w}×${studio3d.h} @${studio3d.x},${studio3d.y} · 2d ${studio2d.w}×${studio2d.h} @${studio2d.x},${studio2d.y}`)
      if (name === 'landscape' && studio2d.x < studio3d.x + studio3d.w - 1) fail.push('landscape/preview: the studio panes are not side by side')
      if (name === 'portrait' && studio2d.y < studio3d.y + studio3d.h - 1) fail.push('portrait/preview: the studio panes are not stacked')
      if (studio2d.x + studio2d.w > viewport.width + 1) fail.push(`${name}/preview: the studio runs ${studio2d.x + studio2d.w - viewport.width}px off the right`)
      continue
    }
    if (mode === 'export') {
      // nothing to put in a rail: the pane takes the whole width
      if (!main) { fail.push(`${name}/export: no pane`); continue }
      console.log(` ${name}/export pane ${main.w}×${main.h} @${main.x},${main.y} · rail ${rail ? `${rail.w}×${rail.h}` : 'none'}`)
      if (main.w !== viewport.width) fail.push(`${name}/export: the pane is ${main.w} wide, not ${viewport.width}`)
      if (rail && (rail.w || rail.h)) fail.push(`${name}/export: an empty rail still takes ${rail.w}×${rail.h}`)
      continue
    }
    if (!main || !rail) { fail.push(`${name}/${mode}: no canvas or rail`); continue }
    if (!panels.length) { fail.push(`${name}/${mode}: no panels at all`); continue }
    console.log(` ${name}/${mode} canvas ${main.w}×${main.h} @${main.x},${main.y} · rail ${rail.w}×${rail.h} @${rail.x},${rail.y} · ${panels.length} panel(s)`)
    if (name === 'landscape') {
      if (rail.x < main.x + main.w - 1) fail.push(`landscape/${mode}: the rail starts at ${rail.x}, left of the canvas edge ${main.x + main.w}`)
      if (rail.y > main.y + 2) fail.push(`landscape/${mode}: the rail starts below the canvas top`)
      if (rail.h < main.h * 0.9) fail.push(`landscape/${mode}: the rail is only ${rail.h} tall against a ${main.h} canvas`)
      if (main.h < 250) fail.push(`landscape/${mode}: the canvas is squeezed to ${main.h}px tall`)
      if (rail.w > viewport.width * 0.5) fail.push(`landscape/${mode}: the rail takes ${rail.w} of ${viewport.width}`)
      for (const b of panels) if (b.x < rail.x - 1) fail.push(`landscape/${mode}: a panel sits at x=${b.x}, outside the rail at ${rail.x}`)
    } else {
      if (rail.w || rail.h) fail.push(`portrait/${mode}: the rail should be no box at all, got ${rail.w}×${rail.h}`)
      for (const b of panels) {
        if (b.y < main.y + main.h - 1) fail.push(`portrait/${mode}: a panel at y=${b.y} is not under the canvas (${main.y + main.h})`)
        if (b.x > 1 || b.w !== viewport.width) fail.push(`portrait/${mode}: a panel is ${b.w} wide at x=${b.x}, not the full ${viewport.width}`)
      }
    }
    if (tabs && tabs.y + tabs.h > viewport.height + 1) fail.push(`${name}/${mode}: the tab bar runs off the bottom`)
  }
  await ctx.close()
}

await browser.close()
if (errors.length) fail.push('page errors:\n' + errors.join('\n'))
if (fail.length) { console.error('FAILED:\n' + fail.join('\n')); process.exit(1) }
console.log('ok: panels stack below the canvas upright and sit in a right-hand rail sideways, in every mode')
