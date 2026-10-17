/**
 * The app-private project library: the canonical place projects live on
 * every platform (Tauri: AppData/projects; browser: IndexedDB), plus the
 * recent list and autosaves. Desktop can also keep a project at an external
 * path; Android SAF URIs cannot be reopened silently, so imports are copied
 * into the library.
 */
import { isTauri } from '../platform'

export interface RecentEntry {
  id: string
  name: string
  modifiedAt: string
  /** Absolute external path (desktop Save As / Open), or undefined = library copy. */
  path?: string
  /** PNG thumbnail as a data URL, when available. */
  thumb?: string
}

export interface ProjectLibrary {
  list(): Promise<RecentEntry[]>
  save(entry: RecentEntry, bytes: Uint8Array): Promise<void>
  load(id: string): Promise<Uint8Array | null>
  remove(id: string): Promise<void>
  saveAutosave(id: string, bytes: Uint8Array): Promise<void>
  loadAutosave(id: string): Promise<{ bytes: Uint8Array; modifiedAt: string } | null>
  clearAutosave(id: string): Promise<void>
  touchRecent(entry: RecentEntry): Promise<void>
}

const RECENT_MAX = 20

function mergeRecent(list: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  const rest = list.filter(e => e.id !== entry.id)
  return [entry, ...rest].slice(0, RECENT_MAX)
}

// ── Tauri: files under AppData ───────────────────────────────────────────────

/**
 * Replace a file under AppData whole or not at all: it is written beside the
 * old one, then renamed over it. Autosave rewrites the library often, also as
 * the app goes to the background, when Android may end it mid-write.
 */
export async function replaceAppDataFile(path: string, data: Uint8Array | string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs')
  const baseDir = fs.BaseDirectory.AppData
  const part = `${path}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.part`
  if (typeof data === 'string') await fs.writeTextFile(part, data, { baseDir })
  else await fs.writeFile(part, data, { baseDir })
  await fs.rename(part, path, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
}

const tauriLibrary: ProjectLibrary = {
  async list() {
    const fs = await import('@tauri-apps/plugin-fs')
    try {
      const txt = await fs.readTextFile('recent.json', { baseDir: fs.BaseDirectory.AppData })
      return JSON.parse(txt) as RecentEntry[]
    } catch {
      return []
    }
  },
  async save(entry, bytes) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir('projects', { baseDir: fs.BaseDirectory.AppData, recursive: true })
    await replaceAppDataFile(`projects/${entry.id}.tsprite`, bytes)
    await this.touchRecent(entry)
  },
  async load(id) {
    const fs = await import('@tauri-apps/plugin-fs')
    try {
      return await fs.readFile(`projects/${id}.tsprite`, { baseDir: fs.BaseDirectory.AppData })
    } catch {
      return null
    }
  },
  async remove(id) {
    const fs = await import('@tauri-apps/plugin-fs')
    try { await fs.remove(`projects/${id}.tsprite`, { baseDir: fs.BaseDirectory.AppData }) } catch { /* absent */ }
    try { await fs.remove(`autosave/${id}.tsprite`, { baseDir: fs.BaseDirectory.AppData }) } catch { /* absent */ }
    await replaceAppDataFile('recent.json', JSON.stringify((await this.list()).filter(e => e.id !== id)))
  },
  async saveAutosave(id, bytes) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir('autosave', { baseDir: fs.BaseDirectory.AppData, recursive: true })
    await replaceAppDataFile(`autosave/${id}.tsprite`, bytes)
    await replaceAppDataFile(`autosave/${id}.json`, JSON.stringify({ modifiedAt: new Date().toISOString() }))
  },
  async loadAutosave(id) {
    const fs = await import('@tauri-apps/plugin-fs')
    try {
      const meta = JSON.parse(await fs.readTextFile(`autosave/${id}.json`, { baseDir: fs.BaseDirectory.AppData })) as { modifiedAt: string }
      const bytes = await fs.readFile(`autosave/${id}.tsprite`, { baseDir: fs.BaseDirectory.AppData })
      return { bytes, modifiedAt: meta.modifiedAt }
    } catch {
      return null
    }
  },
  async clearAutosave(id) {
    const fs = await import('@tauri-apps/plugin-fs')
    try { await fs.remove(`autosave/${id}.tsprite`, { baseDir: fs.BaseDirectory.AppData }) } catch { /* absent */ }
    try { await fs.remove(`autosave/${id}.json`, { baseDir: fs.BaseDirectory.AppData }) } catch { /* absent */ }
  },
  async touchRecent(entry) {
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.mkdir('', { baseDir: fs.BaseDirectory.AppData, recursive: true }).catch(() => {})
    await replaceAppDataFile('recent.json', JSON.stringify(mergeRecent(await this.list(), entry)))
  },
}

// ── Browser: IndexedDB ───────────────────────────────────────────────────────

// The database keeps the app's old name (PrSpr editor): renaming it would hide
// every project a browser has already saved.
const DB = 'prspr-editor'
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects')
      if (!db.objectStoreNames.contains('autosave')) db.createObjectStore('autosave')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const r = tx.objectStore(store).get(key)
    r.onsuccess = () => resolve(r.result as T | undefined)
    r.onerror = () => reject(r.error)
  })
}
async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function idbDel(store: string, key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const browserLibrary: ProjectLibrary = {
  async list() {
    return (await idbGet<RecentEntry[]>('meta', 'recent')) ?? []
  },
  async save(entry, bytes) {
    await idbPut('projects', entry.id, bytes)
    await this.touchRecent(entry)
  },
  async load(id) {
    return (await idbGet<Uint8Array>('projects', id)) ?? null
  },
  async remove(id) {
    await idbDel('projects', id)
    await idbDel('autosave', id)
    await idbPut('meta', 'recent', (await this.list()).filter(e => e.id !== id))
  },
  async saveAutosave(id, bytes) {
    await idbPut('autosave', id, { bytes, modifiedAt: new Date().toISOString() })
  },
  async loadAutosave(id) {
    return (await idbGet<{ bytes: Uint8Array; modifiedAt: string }>('autosave', id)) ?? null
  },
  async clearAutosave(id) {
    await idbDel('autosave', id)
  },
  async touchRecent(entry) {
    await idbPut('meta', 'recent', mergeRecent(await this.list(), entry))
  },
}

export function getLibrary(): ProjectLibrary {
  return isTauri() ? tauriLibrary : browserLibrary
}

export { mergeRecent }
