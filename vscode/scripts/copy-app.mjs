#!/usr/bin/env node
/**
 * Builds the browser bundle in the repo root and copies it into `media/`,
 * which is the only folder the webview is allowed to load files from.
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ext = resolve(here, '..')
const repo = resolve(ext, '..')
const dist = join(repo, 'dist-web')
const media = join(ext, 'media')

if (!process.argv.includes('--no-build')) {
  console.log('building the web bundle…')
  execSync('pnpm build:web', { cwd: repo, stdio: 'inherit' })
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`no build at ${dist}. Run "pnpm build:web" in ${repo} first.`)
  process.exit(1)
}

rmSync(media, { recursive: true, force: true })
mkdirSync(media, { recursive: true })
cpSync(dist, media, { recursive: true })
console.log(`copied ${dist} → ${media}`)
