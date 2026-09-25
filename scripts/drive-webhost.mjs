#!/usr/bin/env node
/**
 * Checks that the static web build boots when served from an arbitrary
 * sub-path (as on GitHub Pages or a folder of any host), not only at a root.
 *
 *   pnpm build:web
 *   (cd some/dir && python3 -m http.server 8123)   # with dist-web copied under a sub-path
 *   node scripts/drive-webhost.mjs http://127.0.0.1:8123/deep/sub/prspr-editor/ [outDir]
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2]
const outDir = process.argv[3] ?? 'drive-out'
if (!url) { console.error('usage: drive-webhost.mjs <url> [outDir]'); process.exit(2) }
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(300)
await page.screenshot({ path: join(outDir, 'webhost-draw.png') })

// The browser build must hide the Tauri-only export formats and offer a zip download.
await page.locator('.tab:has-text("Export")').first().click()
await page.waitForTimeout(200)
const appOnly = await page.locator('.export__format:has-text("app only")').count()
const download = await page.locator('button:has-text("Download zip")').count()
console.log(`export formats marked app-only: ${appOnly}; download button: ${download}`)
if (appOnly < 2 || download !== 1) errors.push('export panel is not in browser mode')
await page.screenshot({ path: join(outDir, 'webhost-export.png') })

await browser.close()
if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1) }
console.log('web build boots from', url)
