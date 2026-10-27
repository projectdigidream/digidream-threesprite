# Changelog

What changed in each release of ThreeSprite, fixes first. Kept as fixes land:
anything not released yet is under **Unreleased**.

## Unreleased

## 0.2.4 -- 2026-10-27

First out as the dev release 0.2.3.1.

### Added

- **Export some parts on their own**, every animation kept: the Export tab's
  new **Parts** list exports only the ticked ones, a sword or a hat as a layer
  of its own, for games that draw characters in layers. Give them a sprite
  id of their own, and their files sit beside the whole sprite's instead of
  replacing them.

## 0.2.3 -- 2026-10-20

### Fixed

- **Inside the studio's phone app, importing and exporting did nothing**:
  a page in a frame cannot open a file picker or save a download inside an
  Android WebView. ThreeSprite now opens and saves through the studio, with
  the system's own picker and save dialog, for every import, export and
  download.
- **The runtime refused a sprite with no animations** ("this sprite has no
  animations"), so a sprite drawn but not yet animated gave a game no picture
  at all. `loadTsprite`, `inspectTsprite` and `tsprite-atlas` now read it as
  one still animation, `idle`: the drawing as it stands, in every view.

### Added

- **Inside the studio, a module's textures and palette are one tap away**,
  with no files in between, so it works on a phone too:
  - Project menu → **Texture from the module as part…** turns any texture
    painted in qPainter into a new part (its visible layers, flattened). One
    bigger than the canvas comes in shrunk by a whole step, every 2nd, 3rd or
    4th pixel, so pixel art stays crisp.
  - The palette editor's **Import → From the module** takes the module's
    palette or a texture's colours.
  - **Export → To the module's palette** makes the current palette the
    module's, the one qPainter paints from too.

## 0.2.2 -- 2026-10-17

### Fixed

- **A slow finger stroke was thrown away** on a phone: a stroke that had not
  travelled a few screen pixels within half a second was taken for a long
  press, so it vanished and the touch turned into a colour pick. Reaching a
  second pixel now makes it a stroke; only a finger held on one pixel picks a
  colour.
- **Drawing on a variant other than the default was blind.** The canvas kept
  showing the default variant, so a stroke on the picked one did not show,
  neither while drawing nor after. It now shows the variant being painted; in
  Animate, the one the animation has at that frame.
- **A variant or visibility key changed the frames before it too**: a part
  switched to "open hand" at frame 3 was open from frame 1. Before a part's
  first key it now shows its default variant and is visible. Exports and the
  3D view follow.
- **A new variant made its part disappear** wherever it was switched on: it
  started with no images. It now starts as a copy of the variant on the
  canvas, and a view with no image in a variant offers to copy it from
  another variant.

### Changed

- **New sprite starts with how it is seen**, one picture first: **One
  picture** (the default: drawn once, the same from every side), **All the
  way round** (8 views, 5 drawn and 3 mirrored), or **Choose the views…** for
  the view count and mirroring as before. Any of them can be changed later in
  Project settings.
- **The Export tab no longer opens on an error.** It starts on Doom-style
  PNGs only for a sprite that fits them, and on Atlas + JSON otherwise; when
  a format cannot be used, the message names that format ("Can't export as
  Doom-style PNGs"). Inside the Studio it says first that the game needs
  nothing from it.

### Added

- **A choice of canvas background**, in the canvas's top-right corner: dark
  checks (as before), light checks, grey, white or black, so dark art does not
  vanish into the dark checks. Kept on the device, not in the sprite.
- **The bones can be hidden in Animate**, with the bone button in the same
  corner, and hide by themselves while the animation plays. Hidden bones
  cannot be dragged; Rig always shows them.
- **The move fields say where a move goes on screen** in the current view:
  right, up and forward are the character's own, so "Move right" of a
  character facing you now reads "Move right ←". An arrow, or ⊙ / ⊗ for
  towards and away from you; for a child bone, in its parent's frame as posed.
- **Switch a part's variant from the timeline.** With a part's row picked,
  the timeline's bar shows its variant at the current frame; choosing another
  keys the switch there, and the diamond beside it adds or removes that key.
  The part's row names the variant at the playhead and marks, under the
  frames, where a variant other than the default shows.

## 0.2.1 -- 2026-10-17

### Fixed

- **Every new sprite exported as SPRT** unless its id was changed by hand,
  so two sprites made with the defaults replaced each other wherever they
  were brought in. The new-sprite form's id now follows the name as it is
  typed, until the id itself is typed.
- **A new sprite was lost if the app closed before it was saved by hand.**
  It never entered the library, so its autosave could not be found again and
  the app reopened the previous project instead. New sprites now save
  themselves from the first change (see Changed).
- **Drawing without a pause was never autosaved**: every stroke put the
  autosave off again. It now runs at least every ten seconds.
- **Ctrl+O replaced a project with unsaved changes without asking.**
- **A failed autosave went unnoticed.** It now says so, and the • after the
  name stays until a save succeeds.
- **A phone held sideways could squeeze the 3D screen's drawing canvas to a
  sliver** when the Parts panel was open, worst with Android's navigation bar
  on the side.

### Added

- **Save to the file automatically** (project menu, desktop): a project kept
  in a file on disk is written there a second after each change, like a
  library project. Off by default.
- **Open…** offers back unsaved changes from an autosave, as Recent already
  did.

### Changed

- **Autosave saves the project, not only a recovery copy.** A project in the
  app library (every project in the browser and on Android, and on desktop
  until it is saved to a file) is written a second after you stop, and at
  least every ten seconds while you keep going. There is nothing to restore,
  no • after its name, and New, Open and Recent no longer ask to discard
  changes. A project kept in a file on desktop still changes on disk only when
  you save, unless the option above is on.
- Saving large sprites is faster: only the images that changed since the last
  save are encoded again.
- **A phone held sideways gives the canvas the whole height.** The modes move
  up into the toolbar and the views down the canvas's left edge: on a
  412-pixel-tall screen the canvas grows from 267 to 368 pixels square. The
  rail on the right takes the width the square cannot use, so the tools fit in
  two rows, the whole palette shows, and Parts or Solids stay open under them
  (two buttons switch between them).
- Sideways, Animate's timeline fills the rail, with rows and frames sized for
  a finger; the number fields' − and + are bigger; the 3D screen gives the 3D
  view the larger share and keeps its drawing canvas square; Export shows the
  files beside the formats; New sprite, Project settings and Palettes lay their
  fields out in two columns, so New sprite fits without scrolling.

## 0.2.0 -- 2026-10-14

The first public release.
