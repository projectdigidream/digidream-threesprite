/**
 * Open / save / autosave orchestration on top of the store, the library and
 * the file sink. UI components call these; nothing here renders.
 */
import { addPart } from '../../domain/project'
import type { PartImage, Project } from '../../domain/types'
import { autosaveStore, savesItself } from '../../store/autosave'
import { editorStore, type EditorState } from '../../store/editorStore'
import { askConfirm } from '../ui/dialogs'
import { getLibrary, type RecentEntry } from './library'
import { requestHostSave } from './vscodeHost'
import { decodeProject, encodeProject, imageFromPng, projectFileName, thumbnail, PROJECT_EXT } from './projectFile'
import { getSink } from './sink'

function entryFor(p: Project, path?: string): RecentEntry {
  let thumb: string | undefined
  try {
    const png = thumbnail(p)
    let bin = ''
    for (let i = 0; i < png.length; i++) bin += String.fromCharCode(png[i])
    thumb = `data:image/png;base64,${btoa(bin)}`
  } catch { /* optional */ }
  return { id: p.id, name: p.name, modifiedAt: p.meta.modifiedAt, path, thumb }
}

// The document is written one save at a time: an autosave and a Save landing
// together must not interleave in one file, or finish out of order.
let writing: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = writing.then(fn, fn)
  writing = run.catch(() => {})
  return run
}

/** The document as last committed: a drag in progress is not saved half-way. */
function committed(s: EditorState): Project {
  return s.previewBase ?? s.doc
}

/** Write the document where it lives, its linked file or the library, and drop any recovery copy. */
async function writeHome(doc: Project, path: string | undefined): Promise<RecentEntry> {
  const bytes = encodeProject(doc)
  const lib = getLibrary()
  const entry = entryFor(doc, path)
  if (path) {
    await getSink().write({ path, name: entry.name }, bytes)
    await lib.touchRecent(entry)
  } else {
    await lib.save(entry, bytes)
  }
  await lib.clearAutosave(doc.id)
  editorStore.getState().markSaved(doc)
  if (autosaveStore.getState().failed?.id === doc.id) autosaveStore.setState({ failed: null })
  return entry
}

/** Save to the current source: the host when one owns the file, the external path when there is one, else the library. */
export async function saveProject(): Promise<RecentEntry> {
  const s = editorStore.getState()
  if (s.source.host === 'vscode') {
    // VS Code writes the file and calls back for the bytes; it clears the dirty mark.
    requestHostSave()
    return entryFor(s.doc, s.source.path)
  }
  return serial(() => {
    const now = editorStore.getState()
    return writeHome(committed(now), now.source.path)
  })
}

/** Save As: desktop → any path (becomes the source); Android/browser → export a copy. */
export async function saveProjectAs(): Promise<RecentEntry | null> {
  const s = editorStore.getState()
  const sink = getSink()
  const handle = await sink.pickSave(projectFileName(s.doc), PROJECT_EXT, 'Save project as')
  if (!handle) return null
  if (sink.persistentPaths && handle.path && !handle.path.startsWith('content://')) {
    const path = handle.path
    return serial(async () => {
      const entry = await writeHome(committed(editorStore.getState()), path)
      editorStore.getState().setSource({ path })
      return entry
    })
  }
  // A copy went out; the library copy stays canonical.
  await sink.write(handle, encodeProject(committed(editorStore.getState())))
  return saveProject()
}

/**
 * Autosave. A project that saves itself (see `savesItself`) is written where
 * it lives; one linked to a file that autosave may not write gets a recovery
 * copy in the library instead, and stays unsaved. Rejects when the write
 * fails, and records the failure so the unsaved mark comes back.
 */
export function autosaveNow(): Promise<void> {
  return serial(async () => {
    const s = editorStore.getState()
    if (!s.dirty || s.source.host) return
    const doc = committed(s)
    try {
      if (savesItself(s)) {
        await writeHome(doc, s.source.path)
      } else {
        await getLibrary().saveAutosave(doc.id, encodeProject(doc))
        if (autosaveStore.getState().failed?.id === doc.id) autosaveStore.setState({ failed: null })
      }
    } catch (e) {
      autosaveStore.setState({ failed: { id: doc.id, message: e instanceof Error ? e.message : String(e) } })
      throw e
    }
  })
}

/**
 * Before another project takes the current one's place. A project that saves
 * itself is written first and nothing is asked; changes that would otherwise
 * be lost are dropped only if the user agrees, and then their recovery copy
 * goes too. Resolves false to stay.
 */
export async function leaveCurrent(): Promise<boolean> {
  const s = editorStore.getState()
  if (!s.dirty) return true
  if (savesItself(s)) {
    try { await autosaveNow() } catch { /* asked below */ }
    if (!editorStore.getState().dirty) return true
  }
  const failed = autosaveStore.getState().failed
  const message = failed?.id === s.doc.id ? `Autosave could not save them: ${failed.message}` : undefined
  if (!(await askConfirm('Discard unsaved changes in the current project?', { message, okLabel: 'Discard', danger: true }))) return false
  await serial(() => getLibrary().clearAutosave(s.doc.id)).catch(() => {})
  return true
}

/** A recovery copy newer than the project being opened is offered back; declining drops it. */
async function offerRecovery(project: Project): Promise<{ doc: Project; restored: boolean }> {
  const lib = getLibrary()
  const auto = await lib.loadAutosave(project.id)
  if (auto && auto.modifiedAt > project.meta.modifiedAt) {
    try {
      const a = decodeProject(auto.bytes)
      if (await askConfirm(`Restore unsaved changes to “${project.name}”?`, { message: `An autosave from ${new Date(auto.modifiedAt).toLocaleString()} is newer than the saved file.`, okLabel: 'Restore' })) {
        return { doc: a.project, restored: true }
      }
      await lib.clearAutosave(project.id)
    } catch { /* ignore a broken autosave */ }
  }
  return { doc: project, restored: false }
}

/** Load an opened project into the editor. Restored changes count as a fresh edit, so autosave takes them up. */
function show(doc: Project, path: string | undefined, restored: boolean): void {
  editorStore.getState().loadProject(doc)
  editorStore.getState().setSource({ path })
  if (restored) editorStore.setState(s => ({ dirty: true, revision: s.revision + 1 }))
}

export interface OpenResult { project: Project; warnings: string[] }

/** Open a .tsprite the user picks. Non-persistent sources (Android, browser) are imported into the library. */
export async function openProjectFromDisk(): Promise<OpenResult | null> {
  const sink = getSink()
  const picked = await sink.pickOpen([PROJECT_EXT, 'zip'], 'Open project')
  if (!picked) return null
  const { project, warnings } = decodeProject(picked.bytes)
  const external = sink.persistentPaths && picked.handle.path && !picked.handle.path.startsWith('content://') ? picked.handle.path : undefined
  const { doc, restored } = await offerRecovery(project)
  show(doc, external, restored)
  const lib = getLibrary()
  if (external) await lib.touchRecent(entryFor(doc, external))
  else await lib.save(entryFor(project), picked.bytes)
  return { project: doc, warnings }
}

export async function openRecent(entry: RecentEntry): Promise<OpenResult> {
  const lib = getLibrary()
  let bytes: Uint8Array | null = null
  if (entry.path) {
    try {
      bytes = await getSink().read({ path: entry.path, name: entry.name })
    } catch {
      bytes = null
    }
  }
  if (!bytes) bytes = await lib.load(entry.id)
  if (!bytes) throw new Error(`"${entry.name}" is no longer available`)
  const { project, warnings } = decodeProject(bytes)
  const { doc, restored } = await offerRecovery(project)
  show(doc, entry.path && bytes ? entry.path : undefined, restored)
  await lib.touchRecent(entryFor(doc, entry.path))
  return { project: doc, warnings }
}

export async function removeFromLibrary(id: string): Promise<void> {
  await getLibrary().remove(id)
}

/** Import a PNG as a new part image on the selected bone (view 1). */
export async function importPngAsPart(): Promise<string | null> {
  const picked = await getSink().pickOpen(['png'], 'Import PNG as a part')
  if (!picked) return null
  return addImagePart(imageFromPng(picked.bytes), picked.handle.name.replace(/\.png$/i, ''))
}

/** A new part on the selected bone (view 1) whose image is `img`. */
export function addImagePart(img: PartImage, name: string): string | null {
  const s = editorStore.getState()
  const n = s.doc.canvas.size
  if (img.width > n || img.height > n) throw new Error(`The image is ${img.width}×${img.height} but the canvas is ${n}×${n}. Resize it first.`)
  const boneId = s.ui.selectedBoneId ?? s.doc.skeleton.rootOrder[0]
  if (!boneId) throw new Error('The rig has no bone to attach the image to.')
  let id: string | null = null
  s.commit('Import image', d => {
    id = addPart(d, { boneId, name, image: img, pivot: { x: Math.floor(img.width / 2), y: img.height } }).id
  })
  if (id) s.selectPart(id)
  return id
}
