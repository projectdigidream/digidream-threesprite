import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  drawResolved, durationSeconds, frameAt, groundFromTurns, isFinished, placeResolved, Playhead,
  relativeTurns, turnsFromGround, turnsFromYawDegrees, turnsFromYawRadians, viewAngleTurns, viewFor,
} from '../out/index.js'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

test('view 1 faces the viewer and the numbers rise anticlockwise', () => {
  // eight views: the classic case
  assert.equal(viewFor(8, 0), 1, 'front')
  assert.equal(viewFor(8, 0.25), 3, 'a quarter turn anticlockwise is the left side')
  assert.equal(viewFor(8, 0.5), 5, 'back')
  assert.equal(viewFor(8, 0.75), 7, 'right side')
  close(viewAngleTurns(8, 3), 0.25)
})

test('each view owns the arc centred on its own angle', () => {
  for (const n of [1, 3, 4, 6, 8, 16, 64]) {
    for (let k = 1; k <= n; k++) {
      const centre = viewAngleTurns(n, k)
      assert.equal(viewFor(n, centre), k, `${n} views, centre of ${k}`)
      const almostHalf = 0.5 / n - 1e-6
      assert.equal(viewFor(n, centre + almostHalf), k, `${n} views, just inside ${k}`)
      assert.equal(viewFor(n, centre - almostHalf), k, `${n} views, just inside ${k} the other way`)
    }
  }
})

test('one view swallows the whole circle', () => {
  for (const t of [0, 0.1, 0.5, 0.9, -0.3]) assert.equal(viewFor(1, t), 1)
})

test('view selection wraps and never leaves the range', () => {
  for (let i = 0; i < 500; i++) {
    const n = 1 + (i % 64)
    const t = (i * 0.7351) - 4
    const v = viewFor(n, t)
    assert.ok(Number.isInteger(v) && v >= 1 && v <= n, `${n} views at ${t} gave ${v}`)
    assert.equal(v, viewFor(n, t + 3), 'whole turns make no difference')
  }
})

test('relative bearing is the difference, wrapped', () => {
  close(relativeTurns(0.6, 0.1), 0.5)
  close(relativeTurns(0.1, 0.6), 0.5)
  close(relativeTurns(0.1, 0.2), 0.9)
  close(relativeTurns(2.35, 0.1), 0.25)
})

test('ground headings round-trip, in both worlds', () => {
  for (const ground of ['zBack', 'zForward']) {
    for (const t of [0, 0.125, 0.25, 0.5, 0.875]) {
      const v = groundFromTurns(t, ground)
      close(turnsFromGround(v.x, v.z, ground), t, 1e-9)
    }
  }
  // +x is always the zero heading; the two worlds disagree about which way a
  // quarter turn goes, which is exactly the Unity-versus-three.js difference
  close(turnsFromGround(1, 0), 0)
  close(turnsFromGround(0, -1, 'zBack'), 0.25)
  close(turnsFromGround(0, 1, 'zForward'), 0.25)
})

test('yaw arrives in either handedness', () => {
  close(turnsFromYawDegrees(90), 0.25)
  close(turnsFromYawDegrees(90, 'cw'), 0.75)
  close(turnsFromYawRadians(Math.PI), 0.5)
  close(turnsFromYawDegrees(-90), 0.75, 1e-9)
})

test('frames follow the clock', () => {
  const looping = { fps: 4, frameCount: 4, loop: true }
  assert.deepEqual([0, 0.25, 0.5, 0.75, 1, 1.25].map(t => frameAt(looping, t)), [0, 1, 2, 3, 0, 1])
  const once = { fps: 4, frameCount: 4, loop: false }
  assert.deepEqual([0.75, 1, 99].map(t => frameAt(once, t)), [3, 3, 3])
  assert.equal(frameAt({ fps: 0, frameCount: 9, loop: true }, 100), 0, 'zero fps holds the first frame')
  assert.equal(frameAt({ fps: 8, frameCount: 1, loop: true }, 100), 0, 'a single frame stays put')
  assert.equal(frameAt(looping, -5), 0, 'negative time holds the first frame')
})

test('durations and one-shot completion', () => {
  close(durationSeconds({ fps: 4, frameCount: 4, loop: false }), 1)
  assert.equal(durationSeconds({ fps: 0, frameCount: 4, loop: false }), 0)
  assert.equal(isFinished({ fps: 4, frameCount: 4, loop: false }, 0.9), false)
  assert.equal(isFinished({ fps: 4, frameCount: 4, loop: false }, 1), true)
  assert.equal(isFinished({ fps: 4, frameCount: 4, loop: true }, 100), false, 'a loop never finishes')
})

test('the playhead advances, scrubs and restarts', () => {
  const head = new Playhead({ fps: 10, frameCount: 3, loop: false })
  assert.equal(head.frame, 0)
  head.advance(0.1)
  assert.equal(head.frame, 1)
  head.advance(0.1)
  assert.equal(head.frame, 2, 'the last frame appears at 0.2s')
  assert.equal(head.finished, false, 'but the pass is not over until that frame has had its turn')
  head.advance(0.1)
  assert.equal(head.frame, 2, 'a one-shot holds its last frame')
  assert.equal(head.finished, true, 'three frames at 10 fps run for 0.3s')
  head.reset()
  assert.equal(head.frame, 0)
  head.time = 0.1
  assert.equal(head.frame, 1, 'the clock can be set directly')
  head.retime({ fps: 2, frameCount: 8, loop: true })
  assert.equal(head.time, 0)
  assert.equal(head.finished, false)
})

test('drawing hangs the picture from its feet', () => {
  const r = { rect: { x: 5, y: 6, w: 10, h: 20 }, pivot: { x: 4, y: 18 } }
  assert.deepEqual(placeResolved(r, 100, 200), { x: 96, y: 182, w: 10, h: 20 })
  assert.deepEqual(placeResolved(r, 100, 200, 2), { x: 92, y: 164, w: 20, h: 40 })

  const calls = []
  const ctx = { drawImage: (...a) => calls.push(a) }
  drawResolved(ctx, 'sheet', r, 100, 200, { scale: 3 })
  assert.deepEqual(calls[0], ['sheet', 5, 6, 10, 20, 100 - 12, 200 - 54, 30, 60])

  calls.length = 0
  drawResolved(ctx, 'sheet', r, 100, 200, { flipX: true })
  assert.equal(calls[0][5], 100 - (10 - 4), 'flipping mirrors the offset about the feet')
})
