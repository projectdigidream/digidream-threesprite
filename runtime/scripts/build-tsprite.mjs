#!/usr/bin/env node
/**
 * Bundles the `.tsprite` entry point.
 *
 * It reaches into the editor's source for the project reader and the frame
 * rasterizer, so that loading a sprite directly and exporting one from the app
 * run exactly the same code rather than a copy that can drift. tsc cannot do
 * that (the editor's imports carry no extensions), so esbuild bundles it, with
 * the zip and PNG libraries left as real dependencies.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = resolve(here, '..')
const repo = resolve(pkg, '..')

const candidates = [
  join(pkg, 'node_modules', '.bin', 'esbuild'),
  ...['esbuild@0.28.2', 'esbuild'].map(v => join(repo, 'node_modules', '.pnpm', v, 'node_modules', 'esbuild', 'bin', 'esbuild')),
]
let bin = candidates.find(p => existsSync(p))
if (!bin) {
  const found = execFileSync('sh', ['-c', `ls -d ${repo}/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild 2>/dev/null | head -1`]).toString().trim()
  if (found) bin = found
}
if (!bin) {
  console.error('esbuild not found. Run `pnpm install` in the repo root, or `npm i -D esbuild` here.')
  process.exit(1)
}

execFileSync(bin, [
  join(pkg, 'src', 'tsprite.ts'),
  '--bundle',
  '--format=esm',
  '--platform=neutral',
  '--target=es2020',
  '--external:fflate',
  '--external:fast-png',
  // keep one copy of the player: bundling ./sheet.js would give the package a
  // second TSpriteSheet class, and `instanceof` across the two entries would fail
  '--external:./sheet.js',
  `--outfile=${join(pkg, 'out', 'tsprite.js')}`,
], { stdio: 'inherit' })
// declarations: esbuild emits none, so tsc does, with bundler resolution
execFileSync(process.execPath, [join(pkg, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(pkg, 'tsconfig.tsprite.json')], { stdio: 'inherit' })
copyFileSync(join(pkg, 'out-types', 'runtime', 'src', 'tsprite.d.ts'), join(pkg, 'out', 'tsprite.d.ts'))
rmSync(join(pkg, 'out-types'), { recursive: true, force: true })
console.log('bundled out/tsprite.js and its types')
