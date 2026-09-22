#!/usr/bin/env node
/**
 * Runs the built app the way the VS Code extension does: the same generated
 * webview HTML, the same content-security policy, a stubbed `acquireVsCodeApi`,
 * and the real host conversation (ready → init → edit → getBytes → saved).
 *
 * This covers everything that happens inside the webview, which is where the
 * risk is: the policy, the <base> that lazily loaded chunks resolve against,
 * and the bridge. Only the thin extension-host layer is left untested.
 *
 *   cd vscode && npm run build        # compiles the extension and fills media/
 *   node scripts/drive-vscode.mjs [outDir] [projectFile]
 */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
const outDir = args[0] ?? 'drive-out'
const PROJECT = args[1] ?? '~/Library/Application Support/com.digidream.threesprite/projects/A0LhsEcd3YLg.tsprite'
mkdirSync(outDir, { recursive: true })

const repo = resolve(new URL('..', import.meta.url).pathname)
const media = join(repo, 'vscode', 'media')
const builder = join(repo, 'vscode', 'out', 'webviewHtml.js')
for (const [what, p] of [['the web bundle', join(media, 'index.html')], ['the compiled extension', builder]]) {
  if (!existsSync(p)) { console.error(`missing ${what} at ${p} — run "npm run build" in vscode/`); process.exit(2) }
}
const { buildWebviewHtml, makeNonce } = await import(pathToFileURL(builder).href)

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/') {
    const html = buildWebviewHtml(readFileSync(join(media, 'index.html'), 'utf8'), {
      assetRoot: origin,
      nonce,
      cspSource: origin,
    })
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(html)
    return
  }
  const file = join(media, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!file.startsWith(media) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404); res.end('not found'); return
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`
const nonce = makeNonce()

const errors = []
const expect = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); errors.push(msg) } else console.log('ok:', msg) }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage()
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
// A browser tab asks for /favicon.ico on its own; a webview never does.
const ownRequest = (url) => !url.endsWith('/favicon.ico')
page.on('console', m => { if (m.type() === 'error' && ownRequest(m.location()?.url ?? '')) errors.push(`console: ${m.text()} ${m.location()?.url ?? ''}`) })
page.on('requestfailed', r => { if (ownRequest(r.url())) errors.push(`request failed: ${r.url()} — ${r.failure()?.errorText}`) })
page.on('response', r => { if (r.status() >= 400 && ownRequest(r.url())) errors.push(`HTTP ${r.status()} for ${r.url()}`) })

// The webview API VS Code injects, recording everything the app sends out.
await page.addInitScript(() => {
  window.__THREESPRITE_TEST__ = true // lets the production bundle expose its store
  window.__hostInbox = []
  window.acquireVsCodeApi = () => ({
    postMessage: m => { window.__hostInbox.push(m) },
    getState: () => undefined,
    setState: () => {},
  })
})

await page.goto(origin, { waitUntil: 'networkidle' })
await page.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
await page.waitForTimeout(400)

const inbox = () => page.evaluate(() => window.__hostInbox)
const toHost = async (type) => {
  const seen = await inbox()
  return seen.filter(m => m.type === type)
}
const send = (msg) => page.evaluate(m => window.postMessage(m, '*'), msg)

// 1. the app recognises the host and announces itself
expect((await toHost('ready')).length === 1, 'the webview posts exactly one ready message')
expect(await page.evaluate(() => window.__editorStore.getState().doc.name) !== 'Mainchar', 'nothing is restored from the library before the host sends a file')

// 2. the host hands over the file
const body = readFileSync(PROJECT).toString('base64')
await send({ type: 'init', body, path: '/tmp/Mainchar.tsprite' })
await page.waitForTimeout(600)
const loaded = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  return { name: s.doc.name, dirty: s.dirty, host: s.source.host, path: s.source.path, undo: s.history.undo.length, views: s.doc.views.count }
})
expect(loaded.name === 'Mainchar', `the project opened (${loaded.name})`)
expect(loaded.host === 'vscode' && loaded.path === '/tmp/Mainchar.tsprite', `the file path came through (${loaded.path})`)
expect(loaded.dirty === false && loaded.undo === 0, 'a freshly opened file is clean with an empty undo stack')
await page.screenshot({ path: join(outDir, 'vscode-01-opened.png') })

// 3. an edit marks the tab dirty, once per undoable commit
await page.evaluate(() => window.__editorStore.getState().commit('rename', d => { d.name = 'Renamed in VS Code' }))
await page.waitForTimeout(250)
expect((await toHost('edit')).length === 1, 'one edit message per commit')
expect(await page.evaluate(() => window.__editorStore.getState().dirty) === true, 'the document is dirty after an edit')

// a live drag preview is not an edit
await page.evaluate(() => {
  const s = window.__editorStore.getState()
  s.beginPreview(); s.preview(d => { d.name = 'dragging' }); s.endPreview()
})
await page.waitForTimeout(200)
expect((await toHost('edit')).length === 1, 'a drag preview does not report an edit')

// 4. the host asks for bytes, as it does on save
await send({ type: 'getBytes', id: 7 })
await page.waitForTimeout(700)
const [bytesMsg] = await toHost('bytes')
expect(!!bytesMsg && bytesMsg.id === 7, 'the webview answers getBytes with the matching id')
const zip = Buffer.from(bytesMsg?.body ?? '', 'base64')
expect(zip.length > 1000 && zip[0] === 0x50 && zip[1] === 0x4b, `the answer is a zip of ${zip.length} bytes`)

// 5. saving clears the dirty mark
await send({ type: 'saved' })
await page.waitForTimeout(200)
expect(await page.evaluate(() => window.__editorStore.getState().dirty) === false, 'the saved message clears the dirty mark')

// 6. the host drives undo and redo
await send({ type: 'undo' })
await page.waitForTimeout(250)
expect(await page.evaluate(() => window.__editorStore.getState().doc.name) === 'Mainchar', 'undo from the host rolls the edit back')
await send({ type: 'redo' })
await page.waitForTimeout(250)
expect(await page.evaluate(() => window.__editorStore.getState().doc.name) === 'Renamed in VS Code', 'redo from the host puts it back')

// 7. what the webview encoded is a project the webview can open again
await send({ type: 'revert', body: bytesMsg?.body ?? '' })
await page.waitForTimeout(700)
const reverted = await page.evaluate(() => {
  const s = window.__editorStore.getState()
  return { name: s.doc.name, parts: s.doc.partOrder.length, anims: s.doc.animationOrder.length, dirty: s.dirty, host: s.source.host }
})
expect(reverted.name === 'Renamed in VS Code', `the encoded bytes reopen with the edit intact (${reverted.name})`)
expect(reverted.parts > 0 && reverted.anims > 0, `the art and animations survive the round trip (${reverted.parts} parts, ${reverted.anims} animations)`)
expect(reverted.dirty === false && reverted.host === 'vscode', 'a revert leaves the tab clean and still hosted')

// 8. Save in the app asks the host to save rather than writing anywhere itself
await page.evaluate(() => window.__editorStore.getState().commit('touch', d => { d.spriteName = 'ABCD' }))
await page.keyboard.press('Control+s')
await page.waitForTimeout(400)
expect((await toHost('save')).length >= 1, 'Ctrl+S asks the host to save')

// 9. the file menu drops what the editor tab owns
await page.locator('button[aria-label="Project menu"]').click()
await page.waitForSelector('.menu')
const items = await page.locator('.menu__item').allInnerTexts()
expect(!items.some(t => /Open|New project|Download|Save as/i.test(t)), `the menu hides open, new and save-as (${items.map(s => s.split('\n')[0]).join(', ')})`)
expect(items.some(t => /Save/i.test(t)) && items.some(t => /Import PNG/i.test(t)), 'save and PNG import stay')
await page.screenshot({ path: join(outDir, 'vscode-02-menu.png') })
await page.keyboard.press('Escape')

// 10. every tab still works inside the webview
for (const tab of ['Rig', 'Animate', '3D', 'Export']) {
  await page.locator(`.tab:has-text("${tab}")`).first().click()
  await page.waitForTimeout(tab === '3D' ? 1600 : 350)
  await page.screenshot({ path: join(outDir, `vscode-tab-${tab.toLowerCase()}.png`) })
}
expect(await page.locator('.export__format').count() > 0, 'the export panel renders under the policy')

// 11. New Sprite Project: the command opens an empty file
{
  const fresh = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage()
  fresh.on('pageerror', e => errors.push(`new-sprite pageerror: ${e.message}`))
  fresh.on('console', m => { if (m.type() === 'error' && ownRequest(m.location()?.url ?? '')) errors.push(`new-sprite console: ${m.text()}`) })
  await fresh.addInitScript(() => {
    window.__THREESPRITE_TEST__ = true
    window.__hostInbox = []
    window.acquireVsCodeApi = () => ({ postMessage: m => { window.__hostInbox.push(m) }, getState: () => undefined, setState: () => {} })
  })
  await fresh.goto(origin, { waitUntil: 'networkidle' })
  await fresh.waitForSelector('.pixel-canvas__surface', { timeout: 20000 })
  const sent = () => fresh.evaluate(() => window.__hostInbox.map(m => m.type))

  await fresh.evaluate(() => window.postMessage({ type: 'init', body: '', path: '/tmp/hero.tsprite' }, '*'))
  const dialog = fresh.locator('[role="dialog"][aria-label="New project"]')
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  expect(await dialog.count() === 1, 'an empty file opens the new-sprite setup')
  const nameField = dialog.locator('input').first()
  expect(await nameField.inputValue() === 'hero', `the project is named after the file (${await nameField.inputValue()})`)
  expect(await dialog.locator('input[maxlength="4"]').inputValue() === 'HERO', 'the sprite code follows the name')
  expect(!(await sent()).includes('error'), 'no error is reported for the empty file')
  await fresh.screenshot({ path: join(outDir, 'vscode-03-new-sprite.png') })

  // both chip rows hold a 16 and a 32, so each click is scoped to its own field
  await dialog.locator('.field', { hasText: 'Canvas size' }).locator('.chip', { hasText: /^32$/ }).click()
  await dialog.locator('.field', { hasText: 'rotation angles' }).locator('.chip', { hasText: /^16$/ }).click()
  await dialog.locator('button.primary', { hasText: 'Create' }).click()
  await fresh.waitForTimeout(400)

  const types = await sent()
  const tail = types.slice(types.indexOf('ready') + 1)
  expect(tail.join(',') === 'edit,save', `the new project is written straight away (${tail.join(', ')})`)
  const made = await fresh.evaluate(() => {
    const s = window.__editorStore.getState()
    return { name: s.doc.name, size: s.doc.canvas.size, views: s.doc.views.count, host: s.source.host, path: s.source.path }
  })
  expect(made.size === 32 && made.views === 16 && made.name === 'hero', `it has the chosen canvas and views (${made.size}px, ${made.views} views)`)
  expect(made.host === 'vscode' && made.path === '/tmp/hero.tsprite', 'it still belongs to the file that was opened')

  // what VS Code writes on that save is a real project
  await fresh.evaluate(() => window.postMessage({ type: 'getBytes', id: 1 }, '*'))
  await fresh.waitForTimeout(500)
  const b = await fresh.evaluate(() => window.__hostInbox.find(m => m.type === 'bytes')?.body ?? '')
  const z = Buffer.from(b, 'base64')
  expect(z.length > 500 && z[0] === 0x50 && z[1] === 0x4b, `the saved file is a ${z.length}-byte project, not the empty placeholder`)
  await fresh.context().close()
}

await browser.close()
server.close()
if (errors.length) { console.error(`\n${errors.length} problem(s):\n` + errors.join('\n')); process.exit(1) }
console.log('\nvscode webview drive ok')
