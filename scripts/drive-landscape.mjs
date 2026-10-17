#!/usr/bin/env node
/**
 * Drives the phone layout in both orientations: upright the panels stack under
 * the canvas, sideways they sit in a rail down the right-hand side, the modes
 * move up into the toolbar and the views run down the canvas's left edge, so
 * the canvas keeps the whole height. Checks the geometry the browser actually
 * laid out, in every mode.
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

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
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
      main: r('.mobile__main'), rail: r('.mobile__rail'), tabs: r('.tab-bar--bottom'), topTabs: r('.toolbar .tab-bar'), panels,
      studio3d: r('.studio-mobile__3d'), studio2d: r('.studio-mobile__2d'),
      toolbar: r('.toolbar'), views: r('.view-strip'), canvas2d: r('.studio-mobile__2d .pixel-canvas'),
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
    const { main, rail, tabs, topTabs, toolbar, panels, studio3d, studio2d, views, canvas2d } = await boxes(page)
    // the modes: a bottom bar upright, in the toolbar sideways
    if (name === 'landscape') {
      if (tabs && (tabs.w || tabs.h)) fail.push(`landscape/${mode}: the bottom tab bar still takes ${tabs.w}×${tabs.h}`)
      if (!topTabs || !topTabs.w) fail.push(`landscape/${mode}: no modes in the toolbar`)
      else if (topTabs.x + topTabs.w > toolbar.x + toolbar.w + 1) fail.push(`landscape/${mode}: the toolbar's modes run off its end`)
    } else {
      if (!tabs || !tabs.h) fail.push(`portrait/${mode}: no bottom tab bar`)
      if (topTabs && (topTabs.w || topTabs.h)) fail.push(`portrait/${mode}: the toolbar shows the modes too`)
    }
    if (mode === 'preview') {
      // the studio splits itself: stacked upright, side by side sideways
      if (!studio3d || !studio2d) { fail.push(`${name}/preview: no studio panes`); continue }
      console.log(` ${name}/preview 3d ${studio3d.w}×${studio3d.h} @${studio3d.x},${studio3d.y} · 2d ${studio2d.w}×${studio2d.h} @${studio2d.x},${studio2d.y}`)
      if (name === 'landscape' && studio2d.x < studio3d.x + studio3d.w - 1) fail.push('landscape/preview: the studio panes are not side by side')
      if (name === 'landscape' && studio3d.w < studio2d.w) fail.push(`landscape/preview: the 3D view (${studio3d.w}) is narrower than the drawing side (${studio2d.w})`)
      if (name === 'landscape' && canvas2d && canvas2d.h < 200) fail.push(`landscape/preview: the drawing canvas is squeezed to ${canvas2d.h}px tall`)
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
      // nothing but the toolbar above the canvas, and the canvas at least as wide as it is tall
      if (main.y > toolbar.y + toolbar.h + 1) fail.push(`landscape/${mode}: the canvas starts at ${main.y}, not under the toolbar`)
      if (main.h < viewport.height - toolbar.h - 1) fail.push(`landscape/${mode}: the canvas is ${main.h} tall, not the ${viewport.height - toolbar.h} under the toolbar`)
      if (main.w < main.h - 1) fail.push(`landscape/${mode}: the canvas is narrower (${main.w}) than tall (${main.h})`)
      if (!views || views.x + views.w > main.x + 1) fail.push(`landscape/${mode}: the views are not down the canvas's left edge`)
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

// Android's navigation bar takes one side of the screen in landscape and the
// page draws under it. Stand in for the system inset and check that nothing
// interactive is left beneath it.
{
  const ctx = await browser.newContext({ viewport: LANDSCAPE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`inset pageerror: ${e.message}`))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.evaluate(() => window.__editorStore.getState().setUi({ mode: 'draw' }))
  await page.waitForTimeout(300)
  const NAV = 48
  await page.evaluate(n => document.querySelector('.app').style.setProperty('--inset-right', `${n}px`), NAV)
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(outDir, 'landscape-nav-inset.png') })
  const right = await page.evaluate(() => {
    const edge = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return Math.round(b.x + b.width)
    }
    // the controls that live closest to that edge
    const btns = [...document.querySelectorAll('.mobile__rail .icon-btn, .tab-bar button, .toolbar button')]
      .map(el => { const b = el.getBoundingClientRect(); return Math.round(b.x + b.width) })
    return { rail: edge('.mobile__rail'), tabs: edge('.tab-bar'), toolbar: edge('.toolbar'), furthestButton: Math.max(...btns) }
  })
  const limit = LANDSCAPE.width - NAV
  console.log(` inset: with a ${NAV}px navigation bar, right edges — rail ${right.rail}, tabs ${right.tabs}, toolbar ${right.toolbar}, furthest control ${right.furthestButton} (must be ≤ ${limit})`)
  for (const [what, x] of Object.entries(right)) {
    if (x > limit) fail.push(`a ${NAV}px navigation bar would cover the ${what}: it reaches ${x}, past ${limit}`)
  }
  await ctx.close()
}

// Turning the phone with the app open: the modes move between the bottom bar
// and the toolbar, the timeline's frames widen for fingers and narrow again,
// and the mode stays where it was.
{
  const ctx = await browser.newContext({ viewport: PORTRAIT, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`rotate pageerror: ${e.message}`))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.locator('.tab-bar--bottom .tab', { hasText: 'Animate' }).click()
  await page.waitForTimeout(250)
  const look = () => page.evaluate(() => ({
    bottom: !!document.querySelector('.tab-bar--bottom'),
    top: !!document.querySelector('.toolbar .tab-bar'),
    mode: window.__editorStore.getState().ui.mode,
    cell: Math.round(document.querySelector('.timeline__hcell')?.getBoundingClientRect().width ?? 0),
  }))
  const upright = await look()
  await page.setViewportSize(LANDSCAPE)
  await page.waitForTimeout(300)
  const sideways = await look()
  await page.setViewportSize(PORTRAIT)
  await page.waitForTimeout(300)
  const back = await look()
  console.log(` rotate: upright ${JSON.stringify(upright)} · sideways ${JSON.stringify(sideways)} · back ${JSON.stringify(back)}`)
  if (!upright.bottom || upright.top) fail.push('rotate: upright, the modes are not (only) in the bottom bar')
  if (sideways.bottom || !sideways.top) fail.push('rotate: sideways, the modes did not move up into the toolbar')
  if (!back.bottom || back.top) fail.push('rotate: turned back upright, the modes did not return to the bottom bar')
  if ([upright, sideways, back].some(s => s.mode !== 'animate')) fail.push('rotate: turning the phone changed the mode')
  if (!(sideways.cell > upright.cell) || back.cell !== upright.cell) fail.push(`rotate: the timeline's frames are ${upright.cell} → ${sideways.cell} → ${back.cell} wide`)
  await ctx.close()
}

await browser.close()
if (errors.length) fail.push('page errors:\n' + errors.join('\n'))
if (fail.length) { console.error('FAILED:\n' + fail.join('\n')); process.exit(1) }
console.log('ok: panels stack below the canvas upright and sit in a right-hand rail sideways, in every mode')
