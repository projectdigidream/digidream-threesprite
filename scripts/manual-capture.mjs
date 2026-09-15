#!/usr/bin/env node
/**
 * Screenshots for the user manual, taken from a real project through the app's
 * own Open flow.
 *
 *   pnpm dev &
 *   node scripts/manual-capture.mjs <outDir> [projectFile]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const out = process.argv[2]
const PROJECT = process.argv[3] ?? '~/Library/Application Support/com.digidream.threesprite/projects/A0LhsEcd3YLg.tsprite'
if (!out) { console.error('usage: manual-capture.mjs <outDir> [projectFile]'); process.exit(2) }
mkdirSync(out, { recursive: true })
const url = process.env.APP_URL ?? 'http://localhost:1420'
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: GL })
const errors = []

async function openProject(page) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  await page.waitForTimeout(300)
  await page.locator('button[aria-label="Project menu"]').click()
  await page.waitForSelector('.menu')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.menu__item:has-text("Open")').click(),
  ])
  await chooser.setFiles(PROJECT)
  await page.waitForTimeout(900)
  const name = await page.evaluate(() => window.__editorStore.getState().doc.name)
  console.log('loaded:', name)
  return name
}

// ── desktop ────────────────────────────────────────────────────────────────
{
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 880 }, deviceScaleFactor: 2 })).newPage()
  page.on('pageerror', e => errors.push(`desktop pageerror: ${e.message}`))
  const shot = async (name, loc) => {
    const p = join(out, `${name}.png`)
    await (loc ? page.locator(loc) : page).screenshot({ path: p })
    console.log('shot', name)
  }
  await openProject(page)
  await page.evaluate(() => window.__editorStore.getState().setUi({ showArrows: false, spread: false, playing: false }))

  // 1. the Draw tab, whole window
  await page.waitForTimeout(400)
  await shot('01-draw')

  // 2. the view strip on its own
  await shot('02-views', '.view-strip')

  // 3. the palette editor
  await page.locator('button[title^="Palettes"]').first().click()
  await page.waitForSelector('.paled')
  await page.waitForTimeout(300)
  await shot('03-palette', '.paled')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 4. the solids panel with its shapes
  await shot('04-solids', '.desktop__right')

  // 5. the Rig tab
  await page.locator('.tab:has-text("Rig")').first().click()
  await page.waitForTimeout(500)
  await shot('05-rig')

  // 6. the Animate tab
  await page.locator('.tab:has-text("Animate")').first().click()
  await page.waitForTimeout(500)
  await shot('06-animate')

  // 7. the timeline with two keyframes selected, ready to copy
  const keys = page.locator('.timeline__row .timeline__key')
  if (await keys.count() >= 6) {
    await keys.nth(0).click()
    await keys.nth(4).click({ modifiers: ['Shift'] })
    await page.waitForTimeout(250)
  }
  await shot('07-timeline', '.timeline')

  // 8. the 3D studio, one view
  await page.locator('.tab:has-text("3D")').first().click()
  await page.waitForSelector('.preview3d__canvas', { timeout: 15000 })
  await page.waitForTimeout(1500)
  await shot('08-studio')

  // 9. every facing at once
  await page.evaluate(() => window.__editorStore.getState().setUi({ spread: true }))
  await page.waitForTimeout(1500)
  await shot('09-spread')
  await page.evaluate(() => window.__editorStore.getState().setUi({ spread: false }))

  // 10. the Export tab, PNG frames
  await page.locator('.tab:has-text("Export")').first().click()
  await page.waitForTimeout(400)
  const png = page.locator('.export__format:has-text("PNG frames")')
  if (await png.count()) await png.click()
  await page.waitForTimeout(500)
  await shot('10-export')

  await page.context().close()
}

// ── phone ──────────────────────────────────────────────────────────────────
{
  const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage()
  page.on('pageerror', e => errors.push(`mobile pageerror: ${e.message}`))
  const shot = async (name) => { await page.screenshot({ path: join(out, `${name}.png`) }); console.log('shot', name) }
  await openProject(page)
  await page.waitForTimeout(400)
  await shot('11-phone-draw')

  await page.locator('.tab:has-text("Animate")').first().click()
  await page.waitForTimeout(600)
  await shot('12-phone-animate')

  await page.locator('.tab:has-text("3D")').first().click()
  await page.waitForSelector('.preview3d__canvas', { timeout: 15000 })
  await page.waitForTimeout(1600)
  await shot('13-phone-studio')

  await page.context().close()
}

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('manual capture done')
