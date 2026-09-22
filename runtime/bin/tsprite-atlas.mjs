#!/usr/bin/env node
/**
 * Converts a .tsprite into the sheet and manifest an engine reads, without
 * opening the editor. For Unity, Godot, or anything else that would rather
 * import two files than run JavaScript.
 *
 *   npx tsprite-atlas hero.tsprite -o assets/
 *   npx tsprite-atlas hero.tsprite --animations walk,idle --pow2
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadTsprite, inspectTsprite } from '../out/tsprite.js'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name) => argv.includes(name)
const input = argv.find(a => !a.startsWith('-') && argv[argv.indexOf(a) - 1] !== '-o' && argv[argv.indexOf(a) - 1] !== '--animations')

if (!input || has('-h') || has('--help')) {
  console.log(`usage: tsprite-atlas <file.tsprite> [-o outDir] [--animations a,b] [--pow2] [--list]

  -o            where to write; defaults to the current directory
  --animations  only these, by name
  --pow2        round the sheet height up to a power of two
  --list        print what is in the file and write nothing`)
  process.exit(input ? 0 : 2)
}

const bytes = readFileSync(input)

if (has('--list')) {
  const info = inspectTsprite(bytes)
  console.log(`${info.name}  sprite ${info.sprite}  ${info.canvas}px  ${info.views} views`)
  for (const a of info.animations) console.log(`  ${a.name}  ${a.frameCount} frames  ${a.fps} fps${a.loop ? '  loop' : ''}`)
  process.exit(0)
}

const outDir = flag('-o') ?? '.'
const animations = flag('--animations')?.split(',').map(s => s.trim()).filter(Boolean)

const sprite = loadTsprite(bytes, { animations, pow2: has('--pow2') })
mkdirSync(outDir, { recursive: true })
const stem = sprite.sheet.sprite || basename(input).replace(/\.tsprite$/i, '')
writeFileSync(join(outDir, `${stem}.png`), sprite.png)
writeFileSync(join(outDir, `${stem}.json`), sprite.manifestJson)

for (const w of sprite.warnings) console.warn(`warning: ${w}`)
console.log(`${stem}.png  ${sprite.width}×${sprite.height}`)
console.log(`${stem}.json  ${sprite.sheet.viewCount} views, ${sprite.sheet.animationNames.length} animation(s): ${sprite.sheet.animationNames.join(', ')}`)
