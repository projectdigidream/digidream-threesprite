import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ManifestError, TSpriteSheet, turnsFromDegrees } from '../out/index.js'

/** Written by `npm run fixtures`, straight out of the Rust exporter. */
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/sample-atlas.json', import.meta.url)), 'utf8'))
const sheet = TSpriteSheet.parse(manifest)

test('reads what the exporter wrote', () => {
  assert.equal(sheet.sprite, 'HERO')
  assert.equal(sheet.image, 'HERO.png')
  assert.equal(sheet.viewCount, 4)
  assert.equal(sheet.worldHeight, 1.75)
  assert.deepEqual(sheet.canvas, { w: 16, h: 16 })
  assert.deepEqual(sheet.animationNames, ['walk'])
  assert.deepEqual(sheet.size, manifest.size)
})

test('describes its animations', () => {
  const walk = sheet.animation('walk')
  assert.deepEqual(walk, { name: 'walk', fps: 10, frameCount: 2, loop: true, duration: 0.2 })
  assert.equal(sheet.animation(), walk, 'no name gives the first animation')
  assert.equal(sheet.animation('nope'), undefined)
})

test('picks the view from where the camera stands', () => {
  // four views: each owns a quarter turn, centred on its own angle
  const at = (relative) => sheet.viewFor({ relative })
  assert.equal(at(0), 1)
  assert.equal(at(0.25), 2)
  assert.equal(at(0.5), 3)
  assert.equal(at(0.75), 4)
  assert.equal(at(1), 1, 'a full turn comes back round')
  assert.equal(at(-0.25), 4, 'negative angles wrap')
  assert.equal(at(0.124), 1, 'just inside view 1')
  assert.equal(at(0.126), 2, 'just past the halfway point')
})

test('only the difference between facing and bearing matters', () => {
  for (const turn of [0, 0.1, 0.37, 0.5, 0.99, 2.25, -1.4]) {
    assert.equal(
      sheet.viewFor({ facing: turn, bearing: turn + 0.5 }),
      sheet.viewFor({ relative: 0.5 }),
      `facing ${turn}`,
    )
  }
  // a camera behind a character that turns to face it ends up at view 1
  assert.equal(sheet.viewFor({ facing: 0, bearing: 0.5 }), 3)
  assert.equal(sheet.viewFor({ facing: 0.5, bearing: 0.5 }), 1)
})

test('resolves a frame to a rectangle and a pivot', () => {
  const r = sheet.resolve({ animation: 'walk', time: 0, facing: 0, bearing: 0 })
  assert.equal(r.key, 'walk/0/v1')
  assert.equal(r.view, 1)
  assert.equal(r.frame, 0)
  assert.deepEqual(r.rect, manifest.frames['walk/0/v1'].rect)
  assert.deepEqual(r.source, manifest.frames['walk/0/v1'].source)
  // the pivot comes back in pixels as well as normalised
  assert.deepEqual(r.pivotNormalised, manifest.frames['walk/0/v1'].pivot)
  assert.equal(r.pivot.x, r.pivotNormalised.x * r.rect.w)
  assert.equal(r.pivot.y, r.pivotNormalised.y * r.rect.h)
})

test('advances with the clock and loops', () => {
  const frames = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 5].map(t => sheet.resolve({ time: t }).frame)
  assert.deepEqual(frames, [0, 0, 1, 1, 0, 0, 0], 'two frames at 10 fps, looping')
  assert.equal(sheet.resolve({ time: -1 }).frame, 0, 'time before the start holds frame 0')
})

test('an explicit frame wins over the clock and is clamped', () => {
  assert.equal(sheet.resolve({ frame: 1, time: 0 }).frame, 1)
  assert.equal(sheet.resolve({ frame: 99 }).frame, 1)
  assert.equal(sheet.resolve({ frame: -3 }).frame, 0)
})

test('every view of every frame resolves', () => {
  for (const frame of [0, 1]) {
    for (let view = 1; view <= sheet.viewCount; view++) {
      const r = sheet.resolve({ frame, relative: (view - 1) / sheet.viewCount })
      assert.equal(r.key, `walk/${frame}/v${view}`)
      assert.ok(sheet.frame(r.key), 'the key is in the frame table')
    }
  }
})

test('mirrored views are already in the sheet, so nothing is flipped at draw time', () => {
  const mirrored = manifest.views.list.filter(v => v.mirrored)
  assert.ok(mirrored.length > 0, 'the fixture has mirrored views')
  for (const v of mirrored) {
    const r = sheet.resolve({ frame: 0, relative: (v.index - 1) / sheet.viewCount })
    assert.equal(r.view, v.index)
    assert.ok(sheet.frame(r.key), `view ${v.index} has its own picture`)
  }
})

test('reports how far the camera is from the centre of the view it is shown', () => {
  assert.equal(sheet.viewError({ relative: 0 }), 0)
  assert.ok(Math.abs(sheet.viewError({ relative: 0.125 }) - 0.125) < 1e-9, 'worst case is half a step')
  assert.ok(sheet.viewError({ relative: 0.26 }) < 0.02)
})

test('an unknown animation resolves to nothing rather than throwing', () => {
  assert.equal(sheet.resolve({ animation: 'sprint' }), undefined)
})

test('angles arrive in whatever unit the engine uses', () => {
  assert.equal(sheet.viewFor({ relative: turnsFromDegrees(90) }), 2)
  assert.equal(sheet.viewFor({ relative: turnsFromDegrees(-90) }), 4)
})

test('rejects things that are not a ThreeSprite atlas', () => {
  assert.throws(() => TSpriteSheet.parse({ format: 'other' }), ManifestError)
  assert.throws(() => TSpriteSheet.parse('null'), ManifestError)
  assert.throws(() => TSpriteSheet.parse({ ...manifest, version: 2 }), /newer than this library/)
  assert.throws(() => TSpriteSheet.parse({ ...manifest, frames: {} }), /not in the sheet/)
  assert.throws(() => TSpriteSheet.parse({ ...manifest, views: { count: 0, list: [] } }), /positive number/)
})

test('parses from a JSON string too', () => {
  assert.equal(TSpriteSheet.parse(JSON.stringify(manifest)).sprite, 'HERO')
})
