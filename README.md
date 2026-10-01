# PrSpr editor

An editor for animated sprites of characters that live in 3D space and need several rotation views per frame — the classic billboard sprite. Desktop (macOS, Windows, Linux), Android, and a browser build from one codebase.

- **Configurable views**: any number of rotation angles from 1 to 64 (presets 1 / 4 / 6 / 8 / 12 / 16 / 24 / 32), with an optional mirror mode that lets you draw half the circle and derives the rest.
- **3D rig, 2D art**: bones live in the character's own 3D space (right / up / forward) and are projected into each view, so an arm that sticks out sideways in the front view points at the camera in the side view. Hand-drawn part images hang off their bone's projected frame per view, with automatic foreshortening; one skeleton and one set of keys drive every view. Dragging a bone in any view moves or rotates it in that view's plane. Moving a part to another bone (or deleting its bone) re-hangs it without moving it on screen.
- **Skinning**: a part can be influenced by several bones. Its image is cut into a grid; each vertex follows the bones near it (weighted by distance to each bone at rest, with an adjustable influence radius), so one arm image bends at the elbow, stretches when a bone moves away and twists between bones, in the plane of each view. At rest it draws pixel-exactly.
- **Solids**: build a character out of 3D primitives (cube, sphere, cylinder, cone, pyramid) attached to bones. They render live into every view from the same description with a shared depth buffer, quantised pixel-art shading and an outline, and they animate with the rig in 3D. Drag a shape in any view to move it in that view's plane; bake to pixels when you want to paint over them.
- **Depth scaling**: an optional strength (Project settings; 0, the default, keeps the flat projection). With it, whatever hangs off a bone grows as the bone travels towards the camera and shrinks as it goes away — a fist thrown at the viewer, a leg kicking back — for pixel parts, skinned parts and solids alike. The depth is read along each bone, at each pixel's own place on it, so a bone leaning towards the camera tapers what it carries: the end that came forward swells while the joint stays pinned to the rig, on top of the foreshortening that already shortens it. It is the travel that counts, not where a bone sits, so the rest pose never changes size and turning it on cannot alter the art you drew. Sprites move very little in depth, so 1 is about what a real camera would give and barely a pixel; 5–20 is where it reads.
- **Per-view layer order**: parts normally stack the same way everywhere, but any view can keep its own order — an arm in front of the body from the front and behind it from the back, without a second part or a second image. The Parts panel switches between the shared order and the current view's, the view strip marks the views that differ, and a mirrored view is ordered by the view it is flipped from. Adding, deleting and reordering parts keep every view's order in step.
- **Pixel editor**: pencil, eraser, dither, fill, colour picker, rectangle select and move, mirror drawing, ghosting of other parts, onion skin. Touch-first on Android with pinch zoom and long-press picking.
- **Dithering**: an ordered 4×4 Bayer brush with a density from nothing to solid (half is a checkerboard) and an offset that slides the pattern sideways, so a second pass meshes with the first instead of landing on the same pixels. The pattern is anchored to the image, not to the stroke, so dragging back and forth never doubles up.
- **Palettes**: a project holds any number of named palettes and one is active in the Draw tab. The palette editor switches, creates, duplicates, renames and deletes them; adds, removes, reorders and sorts swatches; edits a swatch with a hex field, RGB sliders or the system picker — and can recolour every pixel painted with that swatch, live while you drag, as one undo step. Presets (DawnBringer 16/32, PICO-8, Sweetie 16, Endesga 32, Game Boy, greyscale), "add colours from artwork", and import/export of Lospec/Aseprite `.hex`, GIMP `.gpl` and JASC `.pal` files.
- **Timeline**: per-bone rotation/move/scale keys, per-part visibility and variant keys, linear / ease / step interpolation, scrubbing, drag-to-move keys. Click a keyframe to select it and shift or ⌘/Ctrl-click (or the multi-select toggle, for touch) to pick several, then copy and paste them at another frame with the transport buttons or ⌘/Ctrl+C and V; the spacing between copied frames and their interpolation come along.
- **3D studio**: the sprite as a billboard on a ground grid; orbit the camera and the view swaps exactly as a game picks rotations from the camera bearing. "Spread" shows every facing at once. On desktop the studio shows drawing canvases for every view beside the 3D scene; on a phone it stacks 3D over the drawing canvas (portrait) or side by side (landscape).
- **Phone layout**: held upright, the panels stack under the canvas. Turned sideways — where height is what runs out — they move into a rail down the right-hand side, so the canvas keeps the whole left of the screen: tools, colours and the parts, bones or timeline panel all stay reachable without a sheet covering the art.
- **Exports**: Doom-style PNG names (`NAME` + frame letter + rotation), packed atlas + JSON manifest, individual PNG frames, animated GIF previews (per animation and view plus a turntable). All four work on every platform: the desktop and Android builds encode in Rust, the browser and VS Code builds in TypeScript, and both write the same sheets and manifests.
- **Projects**: `.tsprite` files (a zip of `project.json` + lossless PNGs, format version 3; older files are upgraded on open), an app library with a recent list, autosave, import of PNGs as parts.
- **In VS Code**: a `.tsprite` opens in an editor tab through the extension in `vscode/`, saving and undoing the way the rest of the editor does.
- **Engine runtime**: [`runtime/`](runtime/) plays a sprite in someone else's engine — give it the camera direction and the time, it returns the rectangle to cut from the sheet and the feet to hang it from. It reads an atlas export, or a `.tsprite` directly, and `npx tsprite-atlas hero.tsprite` converts one from the command line for engines that would rather import two files.

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

### Playing sprites in another engine

[`runtime/`](runtime/README.md) is a small library that turns a camera
direction and a clock into the frame to draw. It reads an `Atlas + JSON` export,
or opens a `.tsprite` directly and composes it (the same rasterizer the editor
uses, so the two cannot drift). Its view and timing maths are checked against
the editor's own across every view count from 1 to 64.

```bash
cd runtime
npm install
npm run build
npm test
```

### VS Code

`vscode/` is an extension that opens `.tsprite` files in an editor tab: click a project in the explorer and the whole editor comes up, with `Ctrl`/`Cmd`+`S`, the dirty dot, hot exit and Revert File behaving as they do for any other file. See [vscode/README.md](vscode/README.md).

```bash
cd vscode
npm install
npm run build
npm run package
```

That builds the web bundle into `media/`, compiles the extension and writes
`prspr-editor.vsix`. Install it with `code --install-extension prspr-editor.vsix`,
or from **Extensions → … → Install from VSIX…**.

### Hosting the web version

`pnpm build:web` writes a plain static site to `dist-web/` (an `index.html` with relative asset URLs), so it runs from a domain root or from any sub-folder; no server code, no headers, no environment variables. Put that folder on any static host:

- **Drag and drop**: [Netlify Drop](https://app.netlify.com/drop) or Cloudflare Pages "direct upload" — drop the `dist-web` folder in the browser and you get a URL.
- **One command**: `npx surge dist-web` (asks for an email and gives a `*.surge.sh` address), `npx vercel dist-web`, or `npx wrangler pages deploy dist-web`.
- **GitHub Pages**: push the repo and publish `dist-web` to the `gh-pages` branch (`npx gh-pages -d dist-web`), or let an Actions workflow run `pnpm install && pnpm build:web` and upload `dist-web`. The relative URLs mean the `https://user.github.io/PrSpr editor/` sub-path just works.

Preview locally with `pnpm exec vite preview --config vite.config.web.ts`, or check a sub-path deployment with `node scripts/drive-webhost.mjs <url>`.

What the browser version does and does not do: everything in the editor is the same, and all four export formats work, arriving as a zip download. The only real difference is where projects live: that browser's IndexedDB, so use Project → Save as… to get a `.tsprite` file out.

### Signing (Android release)

A release build is signed, so it installs on a device without further steps.

For your own devices nothing is needed: with no `keystore.properties` present,
Gradle falls back to the standard Android debug key. That key is fine for
sideloading and upgrades a debug build in place, but a store will not take it.

To sign with a real key, generate one once and tell Gradle where it is:

```bash
keytool -genkey -v -keystore release.jks -alias key -keyalg RSA -keysize 2048 -validity 10000
```

Then create `src-tauri/gen/android/keystore.properties` with `storeFile`,
`storePassword`, `keyAlias` and `keyPassword`. Keystores and that properties
file are git-ignored.

Prefer the release build for anything you actually use: the debug APK carries
full Rust debug symbols, which makes it around 134 MB against 7.6 MB, and its
unoptimised rasterizer is noticeably slower to draw.

## Verification

- **Unit tests**: `pnpm test:run` (rasterizer golden pixels, view-selection property tests, project model, undo, exporters' naming, project file round trip) and `cargo test` (bundle parsing, Doom names, atlas packing, PNG/GIF codecs, sinks).
- **Browser-driven smoke**: with `pnpm dev` running, `node scripts/drive.mjs out`, `node scripts/drive-studio.mjs out [--mobile] [--landscape]`, `node scripts/drive-export.mjs out`, `node scripts/drive-dither.mjs out`, `node scripts/drive-landscape.mjs out` drive the installed Google Chrome headlessly through `playwright-core` and write screenshots.
- **VS Code webview**: after `npm run build` in `vscode/`, `node scripts/drive-vscode.mjs out` serves the extension's own generated HTML — same content-security policy, same `<base>`, a stubbed `acquireVsCodeApi` — and plays the host conversation against the built bundle: open a file, edit it, ask for bytes, save, undo, redo and revert. It needs no dev server and no VS Code.
- **Platform self-test**: `THREESPRITE_SELFTEST=1 src-tauri/target/debug/prspr-editor` runs binary IPC, app-data and export checks inside the real desktop app and prints a `SELFTEST {...}` JSON line (the release binary works the same). On Android, `scripts/android-selftest.sh` boots the emulator headlessly, installs the debug APK, triggers the same self-test through an `AppData/selftest` marker and prints `selftest.json`; `scripts/android-saf-export.sh` then drives Export → Save zip through the system file picker and pulls the zip back from Downloads.
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
