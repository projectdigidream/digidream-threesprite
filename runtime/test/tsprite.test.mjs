import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { inspectTsprite, loadTsprite } from '../out/tsprite.js'
import { TSpriteSheet } from '../out/index.js'

/** Written by the editor's own suite; see src/__tests__/core/tspriteFixture.test.ts. */
const bytes = readFileSync(fileURLToPath(new URL('./fixtures/sample.tsprite', import.meta.url)))

test('reads a project without composing it', () => {
  const info = inspectTsprite(bytes)
  assert.equal(info.name, 'Fixture')
  assert.equal(info.sprite, 'FIXT')
  assert.equal(info.canvas, 16)
  assert.equal(info.views, 4)
  assert.deepEqual(info.animations, [{ name: 'walk', fps: 10, loop: true, frameCount: 2 }])
})

test('composes a .tsprite into the same shape as an export', () => {
  const sprite = loadTsprite(bytes)
  assert.ok(sprite.sheet instanceof TSpriteSheet, 'the loader hands back a normal sheet')
  assert.equal(sprite.sheet.sprite, 'FIXT')
  assert.equal(sprite.sheet.viewCount, 4)
  assert.deepEqual(sprite.sheet.animationNames, ['walk'])
  assert.deepEqual(sprite.sheet.animation('walk'), { name: 'walk', fps: 10, frameCount: 2, loop: true, duration: 0.2 })

  // the packed sheet is real pixels, ready for a texture
  assert.equal(sprite.rgba.length, sprite.width * sprite.height * 4)
  assert.ok(sprite.width > 0 && sprite.height > 0, `${sprite.width}×${sprite.height}`)
  assert.ok(sprite.png[0] === 0x89 && sprite.png[1] === 0x50, 'and a PNG of the same sheet')
  assert.deepEqual(sprite.warnings, [], 'nothing odd about the fixture')
})

test('every rotation of every frame is its own picture', () => {
  const { sheet, rgba, width } = loadTsprite(bytes)
  const keys = new Set()
  for (let frame = 0; frame < 2; frame++) {
    for (let v = 1; v <= sheet.viewCount; v++) {
      const r = sheet.resolve({ animation: 'walk', frame, relative: (v - 1) / sheet.viewCount })
      assert.ok(r, `frame ${frame} view ${v} resolves`)
      assert.equal(r.view, v)
      assert.equal(r.frame, frame)
      assert.ok(r.rect.w > 1 && r.rect.h > 1, `frame ${frame} view ${v} has a real rectangle`)
      keys.add(r.key)

      // the rectangle points at pixels that were actually drawn
      let opaque = 0
      for (let y = 0; y < r.rect.h; y++) {
        for (let x = 0; x < r.rect.w; x++) {
          if (rgba[((r.rect.y + y) * width + r.rect.x + x) * 4 + 3] > 0) opaque++
        }
      }
      assert.ok(opaque > 0, `frame ${frame} view ${v} has ink in the sheet`)
    }
  }
  assert.equal(keys.size, 8, 'two frames of four views, none shared')
})

test('the feet land where the editor puts them', () => {
  const { sheet } = loadTsprite(bytes)
  const r = sheet.resolve({ animation: 'walk', frame: 0, relative: 0 })
  // the pivot is the bottom centre of the 16px canvas, relative to the trimmed rect
  assert.ok(Math.abs(r.pivotNormalised.x * r.rect.w - (8 - r.source.x)) < 1e-9, 'feet x follows the trim')
  assert.ok(Math.abs(r.pivotNormalised.y * r.rect.h - (16 - r.source.y)) < 1e-9, 'feet y follows the trim')
  assert.equal(r.pivot.x, r.pivotNormalised.x * r.rect.w)
})

test('a manifest written beside the sheet reloads identically', () => {
  const sprite = loadTsprite(bytes)
  const reparsed = TSpriteSheet.parse(JSON.parse(sprite.manifestJson))
  for (let v = 1; v <= 4; v++) {
    const a = sprite.sheet.resolve({ frame: 1, relative: (v - 1) / 4 })
    const b = reparsed.resolve({ frame: 1, relative: (v - 1) / 4 })
    assert.deepEqual(b, a, `view ${v} matches after a round trip through JSON`)
  }
})

test('picks out the animations asked for', () => {
  const all = loadTsprite(bytes)
  const one = loadTsprite(bytes, { animations: ['walk'] })
  assert.deepEqual(one.sheet.animationNames, all.sheet.animationNames)
  assert.throws(() => loadTsprite(bytes, { animations: ['sprint'] }), /none of the requested animations/)
})

test('reports progress while composing', () => {
  const seen = []
  loadTsprite(bytes, { onProgress: (done, total) => seen.push([done, total]) })
  assert.equal(seen.length, 8, 'two frames of four views')
  assert.deepEqual(seen[0], [1, 8])
  assert.deepEqual(seen[seen.length - 1], [8, 8])
})

test('can round the sheet height up to a power of two', () => {
  const { height } = loadTsprite(bytes, { pow2: true })
  assert.equal(height, 1 << Math.round(Math.log2(height)), `${height} is a power of two`)
})

test('refuses something that is not a project', () => {
  assert.throws(() => loadTsprite(new Uint8Array([1, 2, 3])), /Not a ThreeSprite project/)
})

/** The fixture with every animation taken out: a sprite as it is first drawn. */
async function withoutAnimations() {
  const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate')
  const files = unzipSync(new Uint8Array(bytes))
  const project = JSON.parse(strFromU8(files['project.json']))
  project.animations = {}
  project.animationOrder = []
  files['project.json'] = strToU8(JSON.stringify(project))
  return zipSync(files)
}

test('a sprite with no animations is read as one still "idle": the drawing, every view', async () => {
  const still = await withoutAnimations()
  assert.deepEqual(inspectTsprite(still).animations, [{ name: 'idle', fps: 0, loop: true, frameCount: 1 }])
  const sprite = loadTsprite(still)
  assert.deepEqual(sprite.sheet.animationNames, ['idle'])
  const a = sprite.sheet.animation('idle')
  assert.equal(a.frameCount, 1)
  assert.equal(a.fps, 0)
  for (let v = 1; v <= sprite.sheet.viewCount; v++) {
    const r = sprite.sheet.resolve({ animation: 'idle', time: 3, relative: (v - 1) / sprite.sheet.viewCount })
    assert.equal(r.frame, 0, `view ${v} holds the one frame`)
  }
  assert.ok(sprite.warnings.some(w => /no animations/.test(w)), 'and says why there is an "idle"')
  assert.throws(() => loadTsprite(still, { animations: ['walk'] }), /none of the requested animations.*it has idle/)
})
