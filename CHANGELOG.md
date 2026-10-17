# Changelog

What changed in each release of ThreeSprite, fixes first. Kept as fixes land:
anything not released yet is under **Unreleased**.

## Unreleased

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

## 0.2.0 -- 2026-10-14

The first public release.
