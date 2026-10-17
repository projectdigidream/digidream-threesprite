import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLibrary } from '../../core/io/library'

// The app-data folder as plugin-fs sees it, in memory.
const disk = vi.hoisted(() => ({ files: new Map<string, Uint8Array | string>(), failRename: false }))
vi.mock('@tauri-apps/plugin-fs', () => {
  const missing = (path: string) => new Error(`not found: ${path}`)
  return {
    BaseDirectory: { AppData: 14 },
    mkdir: async () => {},
    writeFile: async (path: string, data: Uint8Array) => { disk.files.set(path, data.slice()) },
    writeTextFile: async (path: string, data: string) => { disk.files.set(path, data) },
    readFile: async (path: string) => { const f = disk.files.get(path); if (!(f instanceof Uint8Array)) throw missing(path); return f },
    readTextFile: async (path: string) => { const f = disk.files.get(path); if (typeof f !== 'string') throw missing(path); return f },
    remove: async (path: string) => { if (!disk.files.delete(path)) throw missing(path) },
    rename: async (from: string, to: string) => {
      if (disk.failRename) throw new Error('killed mid-write')
      const f = disk.files.get(from)
      if (f === undefined) throw missing(from)
      disk.files.delete(from)
      disk.files.set(to, f)
    },
  }
})

const entry = { id: 'imp', name: 'Imp', modifiedAt: '2026-10-17T00:00:00.000Z' }
const parts = () => [...disk.files.keys()].filter(k => k.endsWith('.part'))

describe('the desktop and Android library', () => {
  beforeEach(() => {
    disk.files.clear()
    disk.failRename = false
    ;(window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {}
  })
  afterEach(() => { delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ })

  it('replaces a project whole, and lists it once', async () => {
    const lib = getLibrary()
    await lib.save(entry, new Uint8Array([1, 2, 3]))
    await lib.save({ ...entry, name: 'Imp boss' }, new Uint8Array([4, 5]))
    expect(Array.from((await lib.load('imp'))!)).toEqual([4, 5])
    expect((await lib.list()).map(e => e.name)).toEqual(['Imp boss'])
    expect(parts()).toEqual([])
  })

  it('keeps the last good copy when a write never finishes', async () => {
    const lib = getLibrary()
    await lib.save(entry, new Uint8Array([1, 2, 3]))
    disk.failRename = true
    await expect(lib.save(entry, new Uint8Array([9]))).rejects.toThrow('killed mid-write')
    expect(Array.from((await lib.load('imp'))!)).toEqual([1, 2, 3])
    expect((await lib.list()).map(e => e.id)).toEqual(['imp'])
  })

  it('keeps a recovery copy with its date until it is cleared', async () => {
    const lib = getLibrary()
    await lib.saveAutosave('imp', new Uint8Array([7]))
    const auto = await lib.loadAutosave('imp')
    expect(Array.from(auto!.bytes)).toEqual([7])
    await lib.clearAutosave('imp')
    expect(await lib.loadAutosave('imp')).toBeNull()
    expect(parts()).toEqual([])
  })
})
