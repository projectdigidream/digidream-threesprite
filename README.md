# ThreeSprite

An editor for animated sprites of characters that live in 3D space and need several rotation views per frame — the classic billboard sprite. Desktop (macOS, Windows, Linux), Android, and a browser build from one codebase.

- **Configurable views**: any number of rotation angles from 1 to 64 (presets 1 / 4 / 6 / 8 / 12 / 16 / 24 / 32), with an optional mirror mode that lets you draw half the circle and derives the rest.
- **3D rig, 2D art**: bones live in the character's own 3D space (right / up / forward) and are projected into each view, so an arm that sticks out sideways in the front view points at the camera in the side view. Hand-drawn part images hang off their bone's projected frame per view, with automatic foreshortening; one skeleton and one set of keys drive every view. Dragging a bone in any view moves or rotates it in that view's plane. Moving a part to another bone (or deleting its bone) re-hangs it without moving it on screen.
- **Skinning**: a part can be influenced by several bones. Its image is cut into a grid; each vertex follows the bones near it (weighted by distance to each bone at rest, with an adjustable influence radius), so one arm image bends at the elbow, stretches when a bone moves away and twists between bones, in the plane of each view. At rest it draws pixel-exactly.
- **Solids**: build a character out of 3D primitives (cube, sphere, cylinder, cone, pyramid) attached to bones. They render live into every view from the same description with a shared depth buffer, quantised pixel-art shading and an outline, and they animate with the rig in 3D. Drag a shape in any view to move it in that view's plane; bake to pixels when you want to paint over them.
- **Pixel editor**: pencil, eraser, fill, colour picker, rectangle select and move, mirror drawing, ghosting of other parts, onion skin. Touch-first on Android with pinch zoom and long-press picking.
- **Palettes**: a project holds any number of named palettes and one is active in the Draw tab. The palette editor switches, creates, duplicates, renames and deletes them; adds, removes, reorders and sorts swatches; edits a swatch with a hex field, RGB sliders or the system picker — and can recolour every pixel painted with that swatch, live while you drag, as one undo step. Presets (DawnBringer 16/32, PICO-8, Sweetie 16, Endesga 32, Game Boy, greyscale), "add colours from artwork", and import/export of Lospec/Aseprite `.hex`, GIMP `.gpl` and JASC `.pal` files.
- **Timeline**: per-bone rotation/move/scale keys, per-part visibility and variant keys, linear / ease / step interpolation, scrubbing, drag-to-move keys. Click a keyframe to select it and shift or ⌘/Ctrl-click (or the multi-select toggle, for touch) to pick several, then copy and paste them at another frame with the transport buttons or ⌘/Ctrl+C and V; the spacing between copied frames and their interpolation come along.
- **3D studio**: the sprite as a billboard on a ground grid; orbit the camera and the view swaps exactly as a game picks rotations from the camera bearing. "Spread" shows every facing at once. On desktop the studio shows drawing canvases for every view beside the 3D scene; on a phone it stacks 3D over the drawing canvas (portrait) or side by side (landscape).
- **Exports**: Doom-style PNG names (`NAME` + frame letter + rotation), packed atlas + JSON manifest, individual PNG frames, animated GIF previews (per animation and view plus a turntable).
- **Projects**: `.tsprite` files (a zip of `project.json` + lossless PNGs, format version 3; older files are upgraded on open), an app library with a recent list, autosave, import of PNGs as parts.

## Conventions

- Angles are in turns, anticlockwise seen from above. View 1 is the character facing the viewer; view `k` is what a camera sees at relative bearing `(k−1)/N` turns. At a quarter turn the camera stands at the character's left, so the character appears facing screen-left. This matches Doom's rotation convention, so Doom-style exports need no remapping.
- The character frame is (right, up, forward) in canvas pixels with the origin at the feet. Each view is an orthographic camera (optionally elevated by a project-wide angle): screen-x = −forward·sin(2π·rel) − right·cos(2π·rel), screen-up = up. Bone rotations are Euler degrees (yaw about up, pitch about right, roll about forward); positive yaw turns anticlockwise seen from above and positive roll turns counter-clockwise on screen in the front view.
- Every frame of every view is rendered on one fixed square canvas with the feet on the bottom row, so engines that draw sprites on a feet-anchored quad get consistent frames.
- Mirror mode flips the *composed* frame, so asymmetric poses mirror too. A right-hand prop becomes a left-hand prop in mirrored views.

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| pnpm | ≥ 9 |
| Rust | stable (1.77+) |
| macOS | Xcode Command Line Tools |
| Android | Android Studio (SDK 34+, NDK 29), Java 17, Rust targets `aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` |

## Development

```bash
pnpm install
pnpm dev            # browser build on http://localhost:1420 (no Tauri)
pnpm tauri dev      # desktop app
pnpm typecheck && pnpm test:run          # TypeScript checks and unit tests
(cd src-tauri && cargo test)             # Rust exporter tests
```

### Android

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/29.0.13846066"
export JAVA_HOME="/opt/homebrew/Cellar/openjdk@17/17.0.19/libexec/openjdk.jdk/Contents/Home"   # or Android Studio's JBR
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

pnpm tauri android init                              # once; re-run after adding Tauri plugins
pnpm tauri android dev                               # on a connected device or running emulator
pnpm tauri android build --debug --apk --target aarch64
pnpm tauri android build --apk                       # release (see Signing)
```

Exports on Android go through the system file picker: choose a zip location (Downloads, Drive, …) and the app writes it there.

### Hosting the web version

`pnpm build:web` writes a plain static site to `dist-web/` (an `index.html` with relative asset URLs), so it runs from a domain root or from any sub-folder; no server code, no headers, no environment variables. Put that folder on any static host:

- **Drag and drop**: [Netlify Drop](https://app.netlify.com/drop) or Cloudflare Pages "direct upload" — drop the `dist-web` folder in the browser and you get a URL.
- **One command**: `npx surge dist-web` (asks for an email and gives a `*.surge.sh` address), `npx vercel dist-web`, or `npx wrangler pages deploy dist-web`.
- **GitHub Pages**: push the repo and publish `dist-web` to the `gh-pages` branch (`npx gh-pages -d dist-web`), or let an Actions workflow run `pnpm install && pnpm build:web` and upload `dist-web`. The relative URLs mean the `https://user.github.io/ThreeSprite/` sub-path just works.

Preview locally with `pnpm exec vite preview --config vite.config.web.ts`, or check a sub-path deployment with `node scripts/drive-webhost.mjs <url>`.

What the browser version does and does not do: everything in the editor is the same; projects live in that browser's IndexedDB (use Project → Save as… to get a `.tsprite` file out), and of the exports only Doom-style PNGs and PNG frames are available (as zip downloads); atlas + JSON and GIF need the desktop or Android app.

### Signing (Android release)

Generate a keystore once with `keytool -genkey -v -keystore release.jks -alias key -keyalg RSA -keysize 2048 -validity 10000`, then create `src-tauri/gen/android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Keystores and that properties file are git-ignored.

## Verification

- **Unit tests**: `pnpm test:run` (rasterizer golden pixels, view-selection property tests, project model, undo, exporters' naming, project file round trip) and `cargo test` (bundle parsing, Doom names, atlas packing, PNG/GIF codecs, sinks).
- **Browser-driven smoke**: with `pnpm dev` running, `node scripts/drive.mjs out`, `node scripts/drive-studio.mjs out [--mobile] [--landscape]`, `node scripts/drive-export.mjs out` drive the installed Google Chrome headlessly through `playwright-core` and write screenshots.
- **Platform self-test**: `THREESPRITE_SELFTEST=1 src-tauri/target/debug/threesprite` runs binary IPC, app-data and export checks inside the real desktop app and prints a `SELFTEST {...}` JSON line (the release binary works the same). On Android, `scripts/android-selftest.sh` boots the emulator headlessly, installs the debug APK, triggers the same self-test through an `AppData/selftest` marker and prints `selftest.json`; `scripts/android-saf-export.sh` then drives Export → Save zip through the system file picker and pulls the zip back from Downloads.
- **Handedness check**: make an 8-view project with mirror off and draw, in each view `k`, an arrow pointing `(−sin 2π(k−1)/8, +cos 2π(k−1)/8)` on screen (view 1 towards the viewer, 3 left, 5 up, 7 right) plus the digit `k`. In the 3D studio the drawn arrow must follow the facing arrow as the camera orbits, and "Spread 8" must show 1…8 in order.

## Layout

```
src/domain      pure data model: project, transforms, views, animation sampling, pose, images, palette
src/core        rasterizer + frame cache, tools, 3D scene maths, export plan/bundle/run, project file, library, self-test
src/store       zustand store (undo/redo, ui), playback loop, caches
src/components  canvas, panels, timeline, preview, export, project dialogs, layouts
src-tauri       Rust: export pipeline (bundle → files → dir/zip/content URI), PNG/GIF codecs, atlas packer
scripts         browser-driven smoke drivers
```
