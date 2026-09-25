#!/usr/bin/env node
/**
 * Scales the logo by whole-pixel duplication, so pixel art stays crisp where a
 * smooth resize would blur it. Used to make the sizes each platform wants:
 *
 *   node scripts/upscale-logo.mjs logo.png /tmp/logo-1024.png 1024
 *   pnpm tauri icon /tmp/logo-1024.png          # desktop, Android and iOS icons
 *   node scripts/upscale-logo.mjs logo.png vscode/icon.png 128
 *   cp logo.png public/logo.png                 # the favicon
 */
import { decode, encode } from 'fast-png'
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output, sizeArg] = process.argv
const target = Number(sizeArg)
const img = decode(readFileSync(input))
const src = img.data
const ch = img.channels ?? 4
if (target % img.width !== 0) throw new Error(`${target} is not a whole multiple of ${img.width}`)
const k = target / img.width

const out = new Uint8Array(target * target * 4)
for (let y = 0; y < target; y++) {
  const sy = Math.floor(y / k)
  for (let x = 0; x < target; x++) {
    const sx = Math.floor(x / k)
    const s = (sy * img.width + sx) * ch
    const d = (y * target + x) * 4
    out[d] = src[s]
    out[d + 1] = ch >= 3 ? src[s + 1] : src[s]
    out[d + 2] = ch >= 3 ? src[s + 2] : src[s]
    out[d + 3] = ch === 4 ? src[s + 3] : 255
  }
}
writeFileSync(output, encode({ width: target, height: target, data: out, channels: 4 }))
console.log(`${output}  ${target}×${target}`)
