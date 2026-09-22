# ThreeSprite for VS Code

Opens `.tsprite` projects in an editor tab. Click a sprite project in the
explorer and the full ThreeSprite editor comes up: draw the views, rig the
skeleton, animate it, watch it in the 3D studio and export sheets, without
leaving the window.

The file belongs to VS Code. `Ctrl`/`Cmd`+`S` writes it, the tab shows the
usual dirty dot, unsaved work survives a restart through VS Code's hot exit,
and **File → Revert File** reloads from disk.

## Build

Builds the web bundle into `media/`, then compiles the extension:

```bash
cd vscode
npm install
npm run build
```

`npm run build:app -- --no-build` skips the web build and only copies an
existing `dist-web/`.

Keep comments off the end of these command lines. An interactive zsh does not
strip a trailing `#`, so it arrives as an argument, and `vsce package` reads
its first argument as a version number.

## Try it

Open this folder in VS Code and press `F5` to launch an Extension Development
Host, then open any `.tsprite` file in it.

To start a sprite from scratch, run **ThreeSprite: New Sprite Project** from
the command palette. It asks where to save the file, opens it, and shows the
same setup as the app's own New project: name, sprite code, canvas size and
number of views. Canvas size cannot change once a project exists, which is why
it asks up front. The project is written to the file as soon as you press
Create. Cancel it and the file stays empty; opening it again brings the setup
back.

A window that was already open when you installed the extension will not list
the command until it reloads: run **Developer: Reload Window**.

## Package and install

`npm run package` writes `threesprite.vsix`. To install it:

```bash
npm run package
code --install-extension threesprite.vsix
```

On macOS the `code` command is not on `PATH` until you add it: in VS Code run
**Shell Command: Install 'code' command in PATH** from the command palette.
Until then, call the binary where it lives:

```bash
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension threesprite.vsix
```

Or skip the command line: **Extensions → … → Install from VSIX…**.

## How it fits together

`media/` holds the ordinary browser build of the app. The extension wraps its
`index.html` for the webview: a `<base>` element so the bundle's lazily loaded
chunks resolve against the extension folder, a content-security policy, and a
per-load nonce on the scripts it ships with.

The live project lives in the webview. The extension reads the file once and
sends it over, then asks for bytes back whenever it needs to write, so a
pencil stroke costs one message rather than re-zipping the project. Edits are
reported so VS Code can mark the tab dirty, and its undo and redo are
forwarded into the editor's own history.

Inside VS Code the app hides what the tab already provides: New, Open, Save as
and the recent list go, and its autosave stands down in favour of VS Code's
backups. Export and PNG import stay.

## Known limits

- One tab per file. VS Code reveals the open tab rather than opening a second
  copy, because the project lives in the webview and two copies would drift.
- Undo driven from the app's own toolbar does not pop VS Code's stack, so
  after mixing the two, redo can run out early. Each `Ctrl`+`Z` still undoes
  one step.
- The extension runs in the desktop extension host. It has not been tried in
  vscode.dev or a remote workspace.
