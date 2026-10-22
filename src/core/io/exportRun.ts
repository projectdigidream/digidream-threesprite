/**
 * Runs an export end to end. In Tauri the composed frames go to Rust as one
 * binary bundle and the files are written there (folder, zip, or an Android
 * content:// URI from the system save dialog). In the browser the PNG-only
 * formats are zipped in TypeScript and downloaded.
 */
import { encode as encodePng } from 'fast-png'
import { zipSync } from 'fflate'
import type { Project } from '../../domain/types'
import { buildAtlas } from '../export/atlasBuild'
import { delayForFps, encodeGif } from '../export/gifBuild'
import { planExport, scopedProject, slug } from '../export/plan'
import type { ExportReport, ExportSelection, SinkSpec } from '../export/types'
import { isTauri } from '../platform'
import { downloadBytes } from './browserDownload'
import { buildManifest, collectFrames, encodeBundle } from './exportBundle'
import { invokeWithBytes } from './ipc'

export type Destination = 'dir' | 'zip'

export class ExportCancelled extends Error {
  constructor() { super('cancelled') }
}

export async function runExport(whole: Project, sel: ExportSelection, dest: Destination, onProgress?: (done: number, total: number) => void): Promise<ExportReport> {
  const project = scopedProject(whole, sel)
  const plan = planExport(project, sel)
  if (plan.errors.length) throw new Error(plan.errors.join('\n'))
  if (!isTauri()) return runInBrowser(project, sel, onProgress)

  const sink = await pickSink(project, sel, dest)
  const collected = collectFrames(project, sel.animIds, onProgress)
  const manifest = buildManifest(project, sel, sink, collected)
  const bundle = encodeBundle(manifest, collected.buffers, project.canvas.size)
  const report = await invokeWithBytes<ExportReport>('export_bundle', bundle)
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

/**
 * Every format without Rust: the same sheets, manifests and GIFs the desktop
 * app writes, zipped and downloaded. This is also the path the VS Code
 * extension takes, since its webview is an ordinary browser build.
 */
async function runInBrowser(project: Project, sel: ExportSelection, onProgress?: (done: number, total: number) => void): Promise<ExportReport> {
  const plan = planExport(project, sel)
  const collected = collectFrames(project, sel.animIds, onProgress)
  const n = project.canvas.size
  const N = project.views.count
  const files: Record<string, Uint8Array> = {}
  const warnings = [...plan.warnings]

  /** Frames arrive in animation → frame → view order. */
  const offsets: number[] = []
  let at = 0
  for (const a of collected.animations) { offsets.push(at); at += a.frameCount * N }
  const frameAt = (ai: number, f: number, v: number) => collected.buffers[offsets[ai] + f * N + (v - 1)]

  if (sel.format === 'doom' || sel.format === 'pngs') {
    for (const f of plan.files) {
      if (f.frameIndex === undefined) continue
      const buf = collected.buffers[f.frameIndex]
      files[f.name] = encodePng({ width: n, height: n, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), channels: 4 })
    }
  } else if (sel.format === 'atlas') {
    const atlas = buildAtlas({
      sprite: project.spriteName,
      canvas: n,
      views: { count: N, mirror: project.views.mirror },
      worldHeight: project.export.worldHeight,
      animations: collected.animations,
      frames: collected.frames,
      buffers: collected.buffers,
      pow2: sel.options.atlasPow2,
    })
    files[`${project.spriteName}.png`] = atlas.png
    files[`${project.spriteName}.json`] = new TextEncoder().encode(atlas.json)
    warnings.push(...atlas.warnings)
  } else {
    collected.animations.forEach((anim, ai) => {
      const delay = delayForFps(anim.fps, warnings, anim.name)
      for (let v = 1; v <= N; v++) {
        let frames: Uint8ClampedArray[] = []
        for (let f = 0; f < anim.frameCount; f++) {
          const buf = frameAt(ai, f, v)
          if (buf) frames.push(buf)
        }
        if (frames.length === 0) continue
        if (!(anim.fps > 0)) frames = [frames[0]]
        const gif = encodeGif(frames, n, n, { delaysCs: [delay], repeat: anim.loop })
        warnings.push(...gif.warnings)
        files[`${project.spriteName}_${slug(anim.name)}_v${String(v).padStart(2, '0')}.gif`] = gif.bytes
      }
    })
    // turntable: frame 0 of the first animation, cycling every view
    if (collected.animations.length > 0) {
      const frames: Uint8ClampedArray[] = []
      for (let v = 1; v <= N; v++) {
        const buf = frameAt(0, 0, v)
        if (buf) frames.push(buf)
      }
      if (frames.length > 1) {
        const delay = delayForFps(sel.options.turntableFps, warnings, 'turntable')
        const gif = encodeGif(frames, n, n, { delaysCs: [delay], repeat: true })
        warnings.push(...gif.warnings)
        files[`${project.spriteName}_turntable.gif`] = gif.bytes
      }
    }
  }

  const bytes = Object.values(files).reduce((a, f) => a + f.length, 0)
  const zip = zipSync(files, { level: 6 })
  const name = `${project.spriteName}-${sel.format}.zip`
  downloadBytes(name, zip, 'application/zip')
  return { files: Object.keys(files), warnings: dedupe(warnings), bytes, location: `download: ${name}` }
}

/** The same timing note comes back once per view; say it once. */
function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}
