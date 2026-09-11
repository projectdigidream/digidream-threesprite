/**
 * Runs an export end to end. In Tauri the composed frames go to Rust as one
 * binary bundle and the files are written there (folder, zip, or an Android
 * content:// URI from the system save dialog). In the browser the PNG-only
 * formats are zipped in TypeScript and downloaded.
 */
import { encode as encodePng } from 'fast-png'
import { zipSync } from 'fflate'
import type { Project } from '../../domain/types'
import { planExport } from '../export/plan'
import type { ExportReport, ExportSelection, SinkSpec } from '../export/types'
import { isTauri } from '../platform'
import { downloadBytes } from './browserDownload'
import { buildManifest, collectFrames, encodeBundle } from './exportBundle'

export type Destination = 'dir' | 'zip'

export class ExportCancelled extends Error {
  constructor() { super('cancelled') }
}

export async function runExport(project: Project, sel: ExportSelection, dest: Destination, onProgress?: (done: number, total: number) => void): Promise<ExportReport> {
  const plan = planExport(project, sel)
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  if (!isTauri()) return runInBrowser(project, sel, onProgress)

  const sink = await pickSink(project, sel, dest)
  const collected = collectFrames(project, sel.animIds, onProgress)
  const manifest = buildManifest(project, sel, sink, collected)
  const bundle = encodeBundle(manifest, collected.buffers, project.canvas.size)
  const { invoke } = await import('@tauri-apps/api/core')
  const report = await invoke<ExportReport>('export_bundle', bundle)
  return { ...report, warnings: [...plan.warnings, ...report.warnings] }
}

async function pickSink(project: Project, sel: ExportSelection, dest: Destination): Promise<SinkSpec> {
  const { open, save } = await import('@tauri-apps/plugin-dialog')
  if (dest === 'dir') {
    const picked = await open({ directory: true, multiple: false, title: 'Export folder' })
    if (!picked) throw new ExportCancelled()
    return { kind: 'dir', path: typeof picked === 'string' ? picked : String(picked) }
  }
  const path = await save({ defaultPath: `${project.spriteName}-${sel.format}.zip`, filters: [{ name: 'Zip archive', extensions: ['zip'] }], title: 'Export as zip' })
  if (!path) throw new ExportCancelled()
  return path.startsWith('content://') ? { kind: 'zip', contentUri: path } : { kind: 'zip', path }
}

async function runInBrowser(project: Project, sel: ExportSelection, onProgress?: (done: number, total: number) => void): Promise<ExportReport> {
  if (sel.format !== 'doom' && sel.format !== 'pngs') throw new Error('This format needs the desktop or Android app; the browser build exports PNG formats only.')
  const plan = planExport(project, sel)
  const collected = collectFrames(project, sel.animIds, onProgress)
  const n = project.canvas.size
  const files: Record<string, Uint8Array> = {}
  let bytes = 0
  for (const f of plan.files) {
    if (f.frameIndex === undefined) continue
    const buf = collected.buffers[f.frameIndex]
    const png = encodePng({ width: n, height: n, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), channels: 4 })
    files[f.name] = png
    bytes += png.length
  }
  const zip = zipSync(files, { level: 6 })
  const name = `${project.spriteName}-${sel.format}.zip`
  downloadBytes(name, zip, 'application/zip')
  return { files: Object.keys(files), warnings: plan.warnings, bytes, location: `download: ${name}` }
}
