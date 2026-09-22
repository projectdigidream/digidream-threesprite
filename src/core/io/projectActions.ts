/**
 * Open / save / autosave orchestration on top of the store, the library and
 * the file sink. UI components call these; nothing here renders.
 */
import { addPart } from '../../domain/project'
import type { Project } from '../../domain/types'
import { editorStore } from '../../store/editorStore'
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

/** Save to the current source: the host when one owns the file, the external path when there is one, else the library. */
export async function saveProject(): Promise<RecentEntry> {
  const s = editorStore.getState()
  if (s.source.host === 'vscode') {
    // VS Code writes the file and calls back for the bytes; it clears the dirty mark.
    requestHostSave()
    return entryFor(s.doc, s.source.path)
  }
  const bytes = encodeProject(s.doc)
  const lib = getLibrary()
  const entry = entryFor(s.doc, s.source.path)
  if (s.source.path) {
    await getSink().write({ path: s.source.path, name: entry.name }, bytes)
    await lib.touchRecent(entry)
  } else {
    await lib.save(entry, bytes)
  }
  await lib.clearAutosave(s.doc.id)
  s.markSaved()
  return entry
}

/** Save As: desktop → any path (becomes the source); Android/browser → export a copy. */
export async function saveProjectAs(): Promise<RecentEntry | null> {
  const s = editorStore.getState()
  const sink = getSink()
  const handle = await sink.pickSave(projectFileName(s.doc), PROJECT_EXT, 'Save project as')
  if (!handle) return null
  const bytes = encodeProject(s.doc)
  await sink.write(handle, bytes)
  if (sink.persistentPaths && handle.path && !handle.path.startsWith('content://')) {
    editorStore.getState().setSource({ path: handle.path })
    const entry = entryFor(s.doc, handle.path)
    await getLibrary().touchRecent(entry)
    await getLibrary().clearAutosave(s.doc.id)
    s.markSaved()
    return entry
  }
  // A copy went out; the library copy stays canonical.
  return saveProject()
}

export interface OpenResult { project: Project; warnings: string[] }

/** Open a .tsprite the user picks. Non-persistent sources (Android, browser) are imported into the library. */
export async function openProjectFromDisk(): Promise<OpenResult | null> {
  const sink = getSink()
  const picked = await sink.pickOpen([PROJECT_EXT, 'zip'], 'Open project')
  if (!picked) return null
  const { project, warnings } = decodeProject(picked.bytes)
  const external = sink.persistentPaths && picked.handle.path && !picked.handle.path.startsWith('content://') ? picked.handle.path : undefined
  editorStore.getState().loadProject(project)
  editorStore.getState().setSource({ path: external })
  const lib = getLibrary()
  if (external) await lib.touchRecent(entryFor(project, external))
  else await lib.save(entryFor(project), picked.bytes)
  return { project, warnings }
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
  const auto = await lib.loadAutosave(entry.id)
  let restored = false
  let doc = project
  if (auto && auto.modifiedAt > project.meta.modifiedAt) {
    try {
      const a = decodeProject(auto.bytes)
      if (await askConfirm(`Restore unsaved changes to “${project.name}”?`, { message: `An autosave from ${new Date(auto.modifiedAt).toLocaleString()} is newer than the saved file.`, okLabel: 'Restore' })) {
        doc = a.project
        restored = true
      } else {
        await lib.clearAutosave(entry.id)
      }
    } catch { /* ignore a broken autosave */ }
  }
  editorStore.getState().loadProject(doc)
  editorStore.getState().setSource({ path: entry.path && bytes ? entry.path : undefined })
  if (restored) editorStore.setState({ dirty: true })
  await lib.touchRecent(entryFor(doc, entry.path))
  return { project: doc, warnings }
}

export async function removeFromLibrary(id: string): Promise<void> {
  await getLibrary().remove(id)
}

export async function autosaveNow(): Promise<void> {
  const s = editorStore.getState()
  if (!s.dirty) return
  await getLibrary().saveAutosave(s.doc.id, encodeProject(s.doc))
}

/** Import a PNG as a new part image on the selected bone (view 1). */
export async function importPngAsPart(): Promise<string | null> {
  const picked = await getSink().pickOpen(['png'], 'Import PNG as a part')
  if (!picked) return null
  const img = imageFromPng(picked.bytes)
  const s = editorStore.getState()
  const n = s.doc.canvas.size
  if (img.width > n || img.height > n) throw new Error(`The image is ${img.width}×${img.height} but the canvas is ${n}×${n}. Resize it first.`)
  const boneId = s.ui.selectedBoneId ?? s.doc.skeleton.rootOrder[0]
  if (!boneId) throw new Error('The rig has no bone to attach the image to.')
  let id: string | null = null
  s.commit('Import PNG', d => {
    id = addPart(d, { boneId, name: picked.handle.name.replace(/\.png$/i, ''), image: img, pivot: { x: Math.floor(img.width / 2), y: img.height } }).id
  })
  if (id) s.selectPart(id)
  return id
}
