import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { autosaveNow, leaveCurrent, openRecent } from '../../core/io/projectActions'
import { decodeProject, encodeProject } from '../../core/io/projectFile'
import { dialogStore, resolveCurrent } from '../../core/ui/dialogs'
import { createProject } from '../../domain/project'
import { scheduleAutosave } from '../../hooks/useAutosave'
import { autosaveStore, needsSave, savesItself } from '../../store/autosave'
import { editorStore } from '../../store/editorStore'

// An in-memory library and file sink, recording what was written where.
const fakes = vi.hoisted(() => {
  const projects = new Map<string, Uint8Array>()
  const recovery = new Map<string, { bytes: Uint8Array; modifiedAt: string }>()
  const files = new Map<string, Uint8Array>()
  /** When set, the next library save waits for this before it lands. */
  const hold: { gate: Promise<void> | null } = { gate: null }
  const lib = {
    list: async () => [],
    save: async (entry: { id: string }, bytes: Uint8Array) => {
      if (hold.gate) { const g = hold.gate; hold.gate = null; await g }
      projects.set(entry.id, bytes)
    },
    load: async (id: string) => projects.get(id) ?? null,
    remove: async () => {},
    saveAutosave: async (id: string, bytes: Uint8Array) => { recovery.set(id, { bytes, modifiedAt: new Date().toISOString() }) },
    loadAutosave: async (id: string) => recovery.get(id) ?? null,
    clearAutosave: async (id: string) => { recovery.delete(id) },
    touchRecent: async () => {},
  }
  const sink = {
    persistentPaths: true,
    fail: null as string | null,
    write: async (h: { path?: string }, bytes: Uint8Array) => {
      if (sink.fail) throw new Error(sink.fail)
      files.set(h.path!, bytes)
    },
    read: async (h: { path?: string }) => files.get(h.path!)!,
    pickSave: async () => null,
    pickOpen: async () => null,
  }
  return { projects, recovery, files, hold, lib, sink }
})
vi.mock('../../core/io/library', () => ({ getLibrary: () => fakes.lib }))
vi.mock('../../core/io/sink', () => ({ getSink: () => fakes.sink }))

const nameIn = (bytes: Uint8Array | undefined) => (bytes ? decodeProject(bytes).project.name : undefined)
const edit = (name: string) => editorStore.getState().commit('Rename', d => { d.name = name })
const doc = () => editorStore.getState().doc

beforeEach(() => {
  fakes.projects.clear(); fakes.recovery.clear(); fakes.files.clear()
  fakes.hold.gate = null; fakes.sink.fail = null
  autosaveStore.setState({ toFile: false, failed: null })
  editorStore.getState().loadProject(createProject({ name: 'Imp', canvasSize: 16 }))
})

describe('autosave of a project in the library', () => {
  it('saves the project itself: no recovery copy, nothing left to save', async () => {
    edit('Imp boss')
    expect(needsSave(editorStore.getState())).toBe(false)
    await autosaveNow()
    expect(nameIn(fakes.projects.get(doc().id))).toBe('Imp boss')
    expect(fakes.recovery.size).toBe(0)
    expect(editorStore.getState().dirty).toBe(false)
  })

  it('drops a recovery copy an older version left behind', async () => {
    await fakes.lib.saveAutosave(doc().id, encodeProject(doc()))
    edit('Imp boss')
    await autosaveNow()
    expect(fakes.recovery.has(doc().id)).toBe(false)
  })

  it('leaves an edit made while the write was under way unsaved', async () => {
    let release!: () => void
    fakes.hold.gate = new Promise<void>(r => { release = r })
    edit('first')
    const saving = autosaveNow()
    await vi.waitFor(() => expect(fakes.hold.gate).toBeNull())
    edit('second')
    release()
    await saving
    expect(nameIn(fakes.projects.get(doc().id))).toBe('first')
    expect(editorStore.getState().dirty).toBe(true)
    await autosaveNow()
    expect(nameIn(fakes.projects.get(doc().id))).toBe('second')
    expect(editorStore.getState().dirty).toBe(false)
  })

  it('writes the committed document while a drag is in progress', async () => {
    edit('before drag')
    const s = editorStore.getState()
    s.beginPreview()
    s.preview(d => { d.name = 'half-way' })
    await autosaveNow()
    expect(nameIn(fakes.projects.get(doc().id))).toBe('before drag')
    // Nothing committed since: the drag's base is what was saved.
    expect(editorStore.getState().dirty).toBe(false)
    editorStore.getState().endPreview('Rename', d => { d.name = 'after drag' })
    expect(editorStore.getState().dirty).toBe(true)
  })

  it('runs one write at a time, in order', async () => {
    let release!: () => void
    fakes.hold.gate = new Promise<void>(r => { release = r })
    edit('one')
    const a = autosaveNow()
    await vi.waitFor(() => expect(fakes.hold.gate).toBeNull())
    edit('two')
    const b = autosaveNow()
    await Promise.resolve()
    expect(fakes.projects.size).toBe(0)
    release()
    await Promise.all([a, b])
    expect(nameIn(fakes.projects.get(doc().id))).toBe('two')
  })

  it('switches to another project without asking, once the changes are written', async () => {
    edit('Imp boss')
    expect(await leaveCurrent()).toBe(true)
    expect(dialogStore.getState().queue).toHaveLength(0)
    expect(nameIn(fakes.projects.get(doc().id))).toBe('Imp boss')
  })
})

describe('autosave of a project linked to a file', () => {
  const PATH = '/sprites/imp.tsprite'
  beforeEach(() => { editorStore.getState().setSource({ path: PATH }) })

  it('keeps a recovery copy and leaves the file to Save', async () => {
    edit('Imp boss')
    expect(savesItself(editorStore.getState())).toBe(false)
    expect(needsSave(editorStore.getState())).toBe(true)
    await autosaveNow()
    expect(fakes.files.size).toBe(0)
    expect(nameIn(fakes.recovery.get(doc().id)?.bytes)).toBe('Imp boss')
    expect(editorStore.getState().dirty).toBe(true)
  })

  it('writes the file itself when autosave may', async () => {
    autosaveStore.getState().setToFile(true)
    expect(localStorage.getItem('threesprite.autosaveToFile')).toBe('1')
    edit('Imp boss')
    expect(needsSave(editorStore.getState())).toBe(false)
    await autosaveNow()
    expect(nameIn(fakes.files.get(PATH))).toBe('Imp boss')
    expect(fakes.recovery.size).toBe(0)
    expect(editorStore.getState().dirty).toBe(false)
  })

  it('shows a failed write as unsaved until a write succeeds', async () => {
    autosaveStore.getState().setToFile(true)
    fakes.sink.fail = 'disk full'
    edit('Imp boss')
    await expect(autosaveNow()).rejects.toThrow('disk full')
    expect(autosaveStore.getState().failed).toEqual({ id: doc().id, message: 'disk full' })
    expect(needsSave(editorStore.getState())).toBe(true)
    fakes.sink.fail = null
    await autosaveNow()
    expect(autosaveStore.getState().failed).toBeNull()
    expect(needsSave(editorStore.getState())).toBe(false)
  })

  it('asks before dropping unsaved changes, and a discard takes the recovery copy with it', async () => {
    edit('Imp boss')
    await autosaveNow()
    const stay = leaveCurrent()
    await vi.waitFor(() => expect(dialogStore.getState().queue).toHaveLength(1))
    resolveCurrent(false)
    expect(await stay).toBe(false)
    expect(fakes.recovery.has(doc().id)).toBe(true)
    const go = leaveCurrent()
    await vi.waitFor(() => expect(dialogStore.getState().queue).toHaveLength(1))
    resolveCurrent(true)
    expect(await go).toBe(true)
    expect(fakes.recovery.has(doc().id)).toBe(false)
  })

  it('offers the recovery copy back on reopening, and restored changes are unsaved', async () => {
    const saved = { ...doc(), meta: { ...doc().meta, modifiedAt: '2026-01-01T00:00:00.000Z' } }
    fakes.files.set(PATH, encodeProject(saved))
    edit('Imp boss')
    await autosaveNow()
    editorStore.getState().loadProject(createProject({ name: 'Other' }))
    const opening = openRecent({ id: saved.id, name: saved.name, modifiedAt: saved.meta.modifiedAt, path: PATH })
    await vi.waitFor(() => expect(dialogStore.getState().queue).toHaveLength(1))
    resolveCurrent(true)
    await opening
    expect(doc().name).toBe('Imp boss')
    expect(editorStore.getState().source.path).toBe(PATH)
    expect(needsSave(editorStore.getState())).toBe(true)
  })
})

describe('autosave timing', () => {
  afterEach(() => { vi.useRealTimers() })

  it('saves a second after the edits stop', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const stop = scheduleAutosave(save, { quietMs: 1000, maxWaitMs: 10000 })
    edit('a')
    vi.advanceTimersByTime(600)
    edit('b')
    vi.advanceTimersByTime(900)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(save).toHaveBeenCalledTimes(1)
    stop()
  })

  it('saves at least every ten seconds while the edits do not stop', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const stop = scheduleAutosave(save, { quietMs: 1000, maxWaitMs: 10000 })
    const times: number[] = []
    save.mockImplementation(() => times.push(Date.now()))
    const t0 = Date.now()
    for (let i = 0; i < 50; i++) { edit(`s${i}`); vi.advanceTimersByTime(500) }
    expect(times.map(t => t - t0)).toEqual([10000, 20000])
    stop()
  })

  it('does not save for a project that was only opened', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const stop = scheduleAutosave(save)
    editorStore.getState().loadProject(createProject({ name: 'Fresh' }))
    vi.advanceTimersByTime(20000)
    expect(save).not.toHaveBeenCalled()
    stop()
  })
})
