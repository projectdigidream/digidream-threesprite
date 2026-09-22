/**
 * Turns the built web app's `index.html` into the HTML a VS Code webview can
 * run. Pure string work and free of any `vscode` import, so it is unit-tested
 * directly with `node --test`.
 */

export interface WebviewHtmlOptions {
  /** Webview URI of the folder holding index.html and assets/, without a trailing slash. */
  assetRoot: string
  /** Per-load nonce for the inline and bundled scripts. */
  nonce: string
  /** `webview.cspSource`, the origin the webview serves extension files from. */
  cspSource: string
}

/**
 * A `<base>` element makes every relative URL in the bundle resolve against the
 * extension's media folder. Rewriting the `src` attributes alone is not enough:
 * the app code-splits, and its dynamic `import()` calls build their URLs at
 * runtime from the document's base, not from anything we can rewrite ahead of
 * time. `script-src` therefore admits the webview origin as well as the nonce,
 * because those lazily loaded chunks carry no nonce of their own.
 */
export function buildWebviewHtml(indexHtml: string, opts: WebviewHtmlOptions): string {
  const root = opts.assetRoot.replace(/\/+$/, '')
  const csp = [
    "default-src 'none'",
    `img-src ${opts.cspSource} data: blob:`,
    `media-src ${opts.cspSource} data: blob:`,
    `font-src ${opts.cspSource} data:`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${opts.nonce}' ${opts.cspSource}`,
    `connect-src ${opts.cspSource} data: blob:`,
    `worker-src ${opts.cspSource} blob:`,
  ].join('; ')

  let html = indexHtml

  // Strip anything that would fight the host: a page-supplied CSP and the
  // favicon, which the tab does not use.
  html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
  html = html.replace(/<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]*>/gi, '')

  const head = `<base href="${root}/">
    <meta http-equiv="Content-Security-Policy" content="${csp}">`

  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, m => `${m}\n    ${head}`)
  else html = `${head}\n${html}`

  // Every script the page ships with needs the nonce; chunks pulled in later
  // are covered by the origin in script-src.
  html = html.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${opts.nonce}"`)

  return html
}

export function makeNonce(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i++) out += alphabet[Math.floor(random() * alphabet.length)]
  return out
}
