/**
 * Messages between the extension host and the editor webview.
 * Mirrored in `src/core/io/vscodeHost.ts` in the app; change both together.
 *
 * Project bytes travel as base64: a `.tsprite` is a zip, and base64 crosses the
 * webview boundary intact on every VS Code version without relying on how
 * typed arrays happen to be cloned.
 */

/** Host → webview. */
export type ToWebview =
  | { type: 'init'; body: string; path: string }
  | { type: 'revert'; body: string }
  | { type: 'getBytes'; id: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' }

/** Webview → host. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'edit' }
  | { type: 'bytes'; id: number; body: string }
  | { type: 'save' }
  | { type: 'error'; message: string }
