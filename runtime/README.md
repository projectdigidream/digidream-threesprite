# @prspr/runtime

Plays PrSpr editor sprites in someone else's engine. Given where the camera is
and how far into an animation you are, it tells you which rectangle to cut from
the sheet and where the character's feet sit inside it.

The player itself has no dependencies, no renderer and no opinion about your
game loop. Around 300 lines, so porting it to a language this package cannot
reach is an afternoon: see [Porting](#porting).

## What it needs

Either of two things:

- An **Atlas + JSON** export: one packed sheet plus a manifest describing every
  frame of every rotation. This is what a shipping game should use.
- A **`.tsprite` project**, loaded directly. See
  [Loading a .tsprite](#loading-a-tsprite).

Mirrored views are real pictures in the sheet either way, so nothing has to be
flipped while drawing.

## Use it

```js
import { TSpriteSheet, turnsFromGround, drawResolved } from '@prspr/runtime'

const sheet = TSpriteSheet.parse(await (await fetch('HERO.json')).json())
const image = await loadImage(sheet.image)          // 'HERO.png', beside the manifest

function draw(actor, camera, ctx, now) {
  const bearing = turnsFromGround(camera.x - actor.x, camera.z - actor.z)
  const r = sheet.resolve({
    animation: 'walk',
    time: now - actor.animationStarted,
    facing: actor.facing,
    bearing,
  })
  if (!r) return                                    // no such animation
  drawResolved(ctx, image, r, actor.screenX, actor.groundY, { scale: 3 })
}
```

`resolve` returns the frame key, the view and frame it chose, the `rect` to cut,
the untrimmed `source` rect, and the `pivot`: the character's feet, in pixels
inside `rect`. Hang the picture from that point and every rotation lines up.

`drawResolved` is a convenience for a 2D canvas. Engines with their own sprite
batching should read `rect` and `pivot` and ignore it; `placeResolved` gives the
destination rectangle if you would rather position the quad yourself.

## Directions

Angles are **turns** — one turn is a full circle — measured anticlockwise seen
from above. Two of them decide what you see:

- **facing** — where the character is heading.
- **bearing** — the direction from the character to the camera.

Only their difference matters, so pass `relative` instead if you already know
it. View 1 is the character looking at you and the numbers rise anticlockwise:
with eight views, view 3 is its left side and view 5 its back.

Helpers convert from whatever your engine hands you:

| You have | Call |
|---|---|
| A vector along the ground | `turnsFromGround(dx, dz)` |
| A yaw in radians or degrees | `turnsFromYawRadians(y)`, `turnsFromYawDegrees(y)` |
| Degrees or radians | `turnsFromDegrees(d)`, `turnsFromRadians(r)` |

Worlds disagree about which way +z points. The default, `zBack`, is the
editor's own and three.js's and Godot's: +z comes towards the viewer. Unity puts
+z away from the viewer, so pass `'zForward'`, and its `eulerAngles.y` turns the
other way, so read yaw with `'cw'`:

```js
const bearing = turnsFromGround(dx, dz, 'zForward')
const facing = turnsFromYawDegrees(transform.eulerAngles.y, 'cw')
```

If a character comes out mirrored or a quarter turn off, this is the knob.

## Time

`resolve({ time })` takes seconds since the animation started and handles
looping, one-shots and a zero frame rate. If you would rather advance by a delta
than track a start time, use a `Playhead`:

```js
const head = new Playhead(sheet.animation('attack'))
head.advance(dt)
const r = sheet.resolve({ animation: 'attack', frame: head.frame, facing, bearing })
if (head.finished) actor.state = 'idle'
```

## Loading a .tsprite

`@prspr/runtime/tsprite` opens a project file with no export step. It
does what the editor does when exporting: composes every frame of every
rotation from the 3D rig, the skinned parts and the solids, then trims and packs
them into one sheet.

```js
import { loadTsprite } from '@prspr/runtime/tsprite'

const { sheet, rgba, width, height } = loadTsprite(await readFile('hero.tsprite'))
const texture = uploadRGBA(rgba, width, height)      // or use the .png field
const r = sheet.resolve({ animation: 'walk', time, facing, bearing })
```

`sheet` is the same object the exported manifest gives, so play-time code does
not change. `inspectTsprite(bytes)` reads the name, canvas, views and animation
list without composing anything.

This entry point is heavier than the player and is a separate import for that
reason: it carries the editor's rasterizer, a zip reader and a PNG decoder
(`fflate` and `fast-png`), and the work happens when the sprite loads — about a
second for a few hundred frames. Prefer the plain export for a shipping game
and this for tools, jams and editors that would rather not have a build step.

`loadTsprite(bytes, { animations: ['walk'], pow2: true, onProgress })` narrows
what is composed, rounds the sheet height up to a power of two, and reports
progress.

## Converting on the command line

For engines this package cannot reach, the same conversion runs as a command
and writes the two files an importer wants:

```bash
npx tsprite-atlas hero.tsprite -o assets/
npx tsprite-atlas hero.tsprite --list
```

That needs no editor and no desktop app, so it drops into an asset pipeline.

## Other things it will tell you

- `sheet.animationNames`, `sheet.animation(name)` — frame rate, frame count,
  whether it loops, how long one pass takes.
- `sheet.viewCount`, `sheet.viewFor({ facing, bearing })`, `sheet.viewAngle(k)`.
- `sheet.viewError({ facing, bearing })` — how far the camera is from the centre
  of the rotation it is being shown, in turns. Above about `0.5 / viewCount`
  something is wrong with your angles; watching it is a quick way to decide
  whether a sprite needs more views.
- `sheet.worldHeight` — the character's height in world units, for sizing the
  billboard.

## Build and test

```bash
npm install
npm run build
npm test
```

The tests run against `test/fixtures/sample-atlas.json`, which is written by the
editor's real Rust exporter rather than typed out by hand. Regenerate it with
`npm run fixtures` after changing the export format.

The loader's tests read `test/fixtures/sample.tsprite`, a project the editor's
own suite saves.

The editor's suite additionally checks that this library and the editor agree on
view selection, frame timing and ground bearings, across every view count from 1
to 64 (`src/__tests__/domain/runtimeParity.test.ts`), and that the sheet built
for a direct load is the same one the Rust exporter writes
(`src/__tests__/core/atlasParity.test.ts`).

## Porting

Everything that matters is four small functions. In pseudocode, with `mod1(t)`
wrapping to `[0, 1)`:

```
relative(bearing, facing) = mod1(bearing - facing)
view(n, relative)         = (round(mod1(relative) * n) mod n) + 1      // 1..n
frame(fps, count, loop, seconds):
    if count <= 1 or fps <= 0 or seconds <= 0: 0
    f = floor(seconds * fps)
    loop ? f mod count : min(f, count - 1)
bearingFromGround(dx, dz)  = mod1(atan2(-dz, dx) / 2π)                  // +z towards the viewer
```

Then look up `animations[a].frames[frame].views[view]` for a key, and
`frames[key]` for its `rect`, `source` and `pivot`. The pivot is the feet point
relative to the trimmed rect, normalised to its size, and it can fall outside
0..1 when trimming cut above the feet, so do not clamp it.
