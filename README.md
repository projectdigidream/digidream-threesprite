# ThreeSprite

An editor for animated sprites of characters that live in 3D space and need several rotation views per frame — the classic billboard sprite. Desktop (macOS, Windows, Linux), Android, and a browser build from one codebase.

- **Configurable views**: any number of rotation angles from 1 to 64 (presets 1 / 4 / 6 / 8 / 12 / 16 / 24 / 32), with an optional mirror mode that lets you draw half the circle and derives the rest.
- **2D cut-out rig**: bones with a rest pose, raster parts attached to bones, one image per view per part, swappable variants. One skeleton and one animation drive every view.
- **Pixel editor**: pencil, eraser, fill, colour picker, rectangle select and move, mirror drawing, ghosting of other parts, onion skin, palette. Touch-first on Android with pinch zoom and long-press picking.
- **Timeline**: per-bone rotation/move/scale keys, per-part visibility and variant keys, linear / ease / step interpolation, scrubbing, drag-to-move keys.
- **3D studio**: the sprite as a billboard on a ground grid; orbit the camera and the view swaps exactly as a game picks rotations from the camera bearing. "Spread" shows every facing at once. On desktop the studio shows drawing canvases for every view beside the 3D scene; on a phone it stacks 3D over the drawing canvas (portrait) or side by side (landscape).
- **Exports**: Doom-style PNG names (`NAME` + frame letter + rotation), packed atlas + JSON manifest, individual PNG frames, animated GIF previews (per animation and view plus a turntable).
- **Projects**: `.tsprite` files (a zip of `project.json` + lossless PNGs), an app library with a recent list, autosave, import of PNGs as parts.

## Conventions

- Angles are in turns, anticlockwise seen from above. View 1 is the character facing the viewer; view `k` is what a camera sees at relative bearing `(k−1)/N` turns. At a quarter turn the camera stands at the character's left, so the character appears facing screen-left. This matches Doom's rotation convention, so Doom-style exports need no remapping.
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

### Signing (Android release)

Generate a keystore once with `keytool -genkey -v -keystore release.jks -alias key -keyalg RSA -keysize 2048 -validity 10000`, then create `src-tauri/gen/android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Keystores and that properties file are git-ignored.

## Verification

- **Unit tests**: `pnpm test:run` (rasterizer golden pixels, view-selection property tests, project model, undo, exporters' naming, project file round trip) and `cargo test` (bundle parsing, Doom names, atlas packing, PNG/GIF codecs, sinks).
- **Browser-driven smoke**: with `pnpm dev` running, `node scripts/drive.mjs out`, `node scripts/drive-studio.mjs out [--mobile] [--landscape]`, `node scripts/drive-export.mjs out` drive the installed Google Chrome headlessly through `playwright-core` and write screenshots.
- **Platform self-test**: `THREESPRITE_SELFTEST=1 src-tauri/target/debug/threesprite` runs IPC, app-data and export checks inside the real desktop app and prints a `SELFTEST {...}` JSON line. On Android, create the marker `files/selftest` in the app's data dir (`adb shell run-as com.digidream.threesprite touch files/selftest`), launch the app, and read `files/selftest.json` or `adb logcat -s RustStdoutStderr`.
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
