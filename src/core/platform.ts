/** Runtime platform detection. One React tree; behaviour branches here. */

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function isWeb(): boolean {
  return !isTauri()
}

/**
 * Running inside the VS Code extension's webview. The host owns the file, so
 * opening, saving and autosave are handed back to it.
 */
export function isVscode(): boolean {
  return typeof window !== 'undefined' && typeof (window as { acquireVsCodeApi?: unknown }).acquireVsCodeApi === 'function'
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
}

export function isIOS(): boolean {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isMobile(): boolean {
  return isAndroid() || isIOS()
}

/** Coarse pointer (touch) — decides hit-target sizes, not layout. */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches
}
