/**
 * Picking and reading/writing user-chosen files, on every platform:
 * - Tauri desktop: native dialogs + plugin-fs on absolute paths.
 * - Tauri Android: the same dialogs open the Storage Access Framework and hand
 *   back content:// URIs, which plugin-fs reads and writes directly.
 * - Browser: download links and <input type=file>.
 * - Embedded (a host page such as the studio sets `window.threespriteHost`):
 *   the host's own picker and save dialog, since a frame's file input and
 *   download link do nothing inside a phone's WebView.
 */
import { isTauri } from '../platform'

/** What an embedding page offers in place of the browser's file input and download link. */
export interface HostFiles {
  open(exts: string[], title?: string): Promise<{ name: string; bytes: Uint8Array } | null>
  /** False when the user cancelled. */
  save(name: string, bytes: Uint8Array): Promise<boolean>
  /** The module the sprite belongs to, when the host has one: its textures and its palette, with no files in between. */
  library?: {
    textures(): Promise<string[]>
    /** A texture's bytes: a PNG, or a qPainter `.texproj.json`. */
    texture(name: string): Promise<Uint8Array>
    /** The module's palette as JSON text, or null when it has none. */
    palette(): Promise<string | null>
  }
}

export function hostFiles(): HostFiles | null {
  return (window as unknown as { threespriteHost?: HostFiles }).threespriteHost ?? null
}

export interface FileHandle {
  /** Absolute path (desktop) or content:// URI (Android); absent in the browser. */
  path?: string
  name: string
}

export interface PickedFile { handle: FileHandle; bytes: Uint8Array }

export interface FileSink {
  pickSave(defaultName: string, ext: string, title?: string): Promise<FileHandle | null>
  write(handle: FileHandle, bytes: Uint8Array): Promise<void>
  pickOpen(exts: string[], title?: string): Promise<PickedFile | null>
  read(handle: FileHandle): Promise<Uint8Array>
  /** Whether handles can be re-opened later without asking the user again. */
  readonly persistentPaths: boolean
}

const tauriSink: FileSink = {
  persistentPaths: true,
  async pickSave(defaultName, ext, title) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], title })
    if (!path) return null
    return { path, name: baseName(path, defaultName) }
  },
  async write(handle, bytes) {
    if (!handle.path) throw new Error('no path')
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(handle.path, bytes)
  },
  async pickOpen(exts, title) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ multiple: false, directory: false, filters: [{ name: exts.join(', '), extensions: exts }], title })
    if (!picked) return null
    const path = typeof picked === 'string' ? picked : String(picked)
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = await readFile(path)
    return { handle: { path, name: baseName(path, 'file') }, bytes }
  },
  async read(handle) {
    if (!handle.path) throw new Error('no path')
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return readFile(handle.path)
  },
}

const browserSink: FileSink = {
  persistentPaths: false,
  async pickSave(defaultName) {
    return { name: defaultName }
  },
  async write(handle, bytes) {
    const { downloadBytes } = await import('./browserDownload')
    downloadBytes(handle.name, bytes)
  },
  pickOpen(exts) {
    return new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = exts.map(e => `.${e}`).join(',')
      input.style.display = 'none'
      document.body.appendChild(input)
      let settled = false
      const finish = (v: PickedFile | null) => { if (!settled) { settled = true; input.remove(); resolve(v) } }
      input.addEventListener('change', async () => {
        const f = input.files?.[0]
        if (!f) return finish(null)
        finish({ handle: { name: f.name }, bytes: new Uint8Array(await f.arrayBuffer()) })
      })
      // Cancel: no reliable event; resolve null when focus returns without a file.
      window.addEventListener('focus', () => setTimeout(() => finish(null), 800), { once: true })
      input.click()
    })
  },
  async read() {
    throw new Error('browser files cannot be re-read without asking')
  },
}

const hostSink = (host: HostFiles): FileSink => ({
  persistentPaths: false,
  async pickSave(defaultName) { return { name: defaultName } },
  async write(handle, bytes) { await host.save(handle.name, bytes) },
  async pickOpen(exts, title) {
    const f = await host.open(exts, title)
    return f ? { handle: { name: f.name }, bytes: f.bytes } : null
  },
  async read() { throw new Error('files from the host cannot be re-read without asking') },
})

export function getSink(): FileSink {
  const host = hostFiles()
  if (host) return hostSink(host)
  return isTauri() ? tauriSink : browserSink
}

export function baseName(path: string, fallback: string): string {
  const seg = path.split(/[\\/]/).pop() ?? ''
  if (path.startsWith('content://')) return fallback
  return seg || fallback
}
