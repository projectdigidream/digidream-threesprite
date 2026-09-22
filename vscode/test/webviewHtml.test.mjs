import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWebviewHtml, makeNonce } from '../out/webviewHtml.js'

const INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <title>ThreeSprite</title>
    <script type="module" crossorigin src="./assets/index.web-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-def.css">
  </head>
  <body><div id="root"></div></body>
</html>`

const opts = { assetRoot: 'https://file+.vscode-resource.example/media', nonce: 'NONCE123', cspSource: 'https://file+.vscode-resource.example' }

test('points relative URLs at the extension folder', () => {
  const html = buildWebviewHtml(INDEX, opts)
  assert.match(html, /<base href="https:\/\/file\+\.vscode-resource\.example\/media\/">/)
  // the bundle's own relative paths are left alone; <base> resolves them,
  // including the chunk URLs its dynamic imports build at runtime
  assert.match(html, /src="\.\/assets\/index\.web-abc\.js"/)
  assert.match(html, /href="\.\/assets\/index-def\.css"/)
})

test('a trailing slash on the asset root does not double up', () => {
  const html = buildWebviewHtml(INDEX, { ...opts, assetRoot: opts.assetRoot + '/' })
  assert.match(html, /<base href="[^"]*\/media\/">/)
  assert.doesNotMatch(html, /media\/\/">/)
})

test('nonces every script the page ships with', () => {
  const html = buildWebviewHtml(INDEX, opts)
  assert.match(html, /<script nonce="NONCE123" type="module"/)
  // every <script> carries the attribute; the policy spells its copy 'nonce-…'
  assert.equal(html.match(/<script/g).length, html.match(/nonce="NONCE123"/g).length)
})

test('keeps an existing nonce rather than adding a second', () => {
  const html = buildWebviewHtml('<head><script nonce="X" src="a.js"></script></head>', opts)
  assert.match(html, /<script nonce="X" src="a\.js">/)
  assert.doesNotMatch(html, /nonce="NONCE123" nonce/)
})

test('writes a policy that admits the bundle, its lazy chunks and inline styles', () => {
  const html = buildWebviewHtml(INDEX, opts)
  const csp = /content="([^"]*default-src[^"]*)"/.exec(html)[1]
  assert.match(csp, /script-src 'nonce-NONCE123' https:\/\/file\+\.vscode-resource\.example/)
  assert.match(csp, /style-src [^;]*'unsafe-inline'/)
  assert.match(csp, /img-src [^;]*data: blob:/)
  assert.match(csp, /worker-src [^;]*blob:/)
  assert.doesNotMatch(csp, /base-uri/) // a base-uri rule would void the <base> above
})

test('drops a page CSP and the favicon so they cannot fight the host', () => {
  const withCsp = INDEX.replace('<title>', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'"><title>')
  const html = buildWebviewHtml(withCsp, opts)
  assert.equal(html.match(/Content-Security-Policy/g).length, 1)
  assert.doesNotMatch(html, /rel="icon"/)
})

test('still produces a usable document when there is no head', () => {
  const html = buildWebviewHtml('<body><div id="root"></div></body>', opts)
  assert.match(html, /<base href=/)
  assert.match(html, /Content-Security-Policy/)
})

test('nonces are long and drawn from a url-safe alphabet', () => {
  assert.match(makeNonce(), /^[A-Za-z0-9]{32}$/)
  assert.notEqual(makeNonce(), makeNonce())
})
