/**
 * Automated platform self-test for the Tauri builds: binary IPC, app-data
 * file I/O and real exports through the Rust pipeline. Triggered by
 * `THREESPRITE_SELFTEST=1` (desktop), a `?selftest` query, or an
 * `AppData/selftest` marker file (Android via adb). Results go to
 * `AppData/selftest.json` and to the `selftest_done` command.
 */
import { createProject } from '../domain/project'
import { DEFAULT_OPTIONS } from './export/types'
import { buildManifest, collectFrames, encodeBundle } from './io/exportBundle'
import { invokeBytes, invokeWithBytes } from './io/ipc'
import { replaceAppDataFile } from './io/library'
import { isTauri } from './platform'

export interface SelfTestReport { ok: boolean; steps: { name: string; ok: boolean; detail: string }[]; platform: string }

export async function shouldSelfTest(): Promise<boolean> {
  if (!isTauri()) return false
  if (typeof location !== 'undefined' && location.search.includes('selftest')) return true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    if (await invoke<boolean>('selftest_flag')) return true
    const fs = await import('@tauri-apps/plugin-fs')
    return await fs.exists('selftest', { baseDir: fs.BaseDirectory.AppData })
  } catch {
    return false
  }
}

export async function runSelfTest(): Promise<SelfTestReport> {
  const { invoke } = await import('@tauri-apps/api/core')
  const fs = await import('@tauri-apps/plugin-fs')
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const steps: SelfTestReport['steps'] = []
  const step = async (name: string, fn: () => Promise<string>) => {
    try { steps.push({ name, ok: true, detail: await fn() }) } catch (e) { steps.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) }) }
  }

  await step('ping', async () => invoke<string>('ping'))
  await step('echo_bytes 1MB', async () => {
    const n = 1 << 20
    const buf = new Uint8Array(n)
    for (let i = 0; i < n; i++) buf[i] = (i * 31 + (i >> 8)) & 0xff
    const t0 = performance.now()
    const out = await invokeBytes('echo_bytes', buf)
    if (out.length !== n) throw new Error(`length ${out.length}`)
    for (let i = 0; i < n; i += 997) if (out[i] !== buf[i]) throw new Error(`mismatch at ${i}`)
    return `${(performance.now() - t0).toFixed(0)} ms`
  })
  await step('appdata write/read', async () => {
    await fs.mkdir('selftest-dir', { baseDir: fs.BaseDirectory.AppData, recursive: true })
    await fs.writeTextFile('selftest-dir/hello.txt', 'hello', { baseDir: fs.BaseDirectory.AppData })
    const back = await fs.readTextFile('selftest-dir/hello.txt', { baseDir: fs.BaseDirectory.AppData })
    if (back !== 'hello') throw new Error('read back mismatch')
    return await appDataDir()
  })
  await step('appdata replace whole', async () => {
    await replaceAppDataFile('selftest-dir/replace.bin', new Uint8Array([1, 2, 3, 4]))
    await replaceAppDataFile('selftest-dir/replace.bin', new Uint8Array([5, 6]))
    const back = await fs.readFile('selftest-dir/replace.bin', { baseDir: fs.BaseDirectory.AppData })
    if (back.join() !== '5,6') throw new Error(`read back ${back.join()}`)
    const left = (await fs.readDir('selftest-dir', { baseDir: fs.BaseDirectory.AppData })).filter(e => e.name.endsWith('.part'))
    if (left.length) throw new Error(`left behind: ${left.map(e => e.name).join(', ')}`)
    return 'replaced by rename'
  })
  await step('export_bundle → dir', async () => {
    const p = createProject({ canvasSize: 16, viewCount: 8, spriteName: 'TEST' })
    const collected = collectFrames(p, p.animationOrder)
    const dir = await join(await appDataDir(), 'selftest-export')
    const manifest = buildManifest(p, { format: 'doom', animIds: p.animationOrder, options: DEFAULT_OPTIONS }, { kind: 'dir', path: dir }, collected)
    const bundle = encodeBundle(manifest, collected.buffers, 16)
    const r = await invokeWithBytes<{ files: string[]; warnings: string[]; bytes: number; location: string }>('export_bundle', bundle)
    if (r.files.length !== 32) throw new Error(`expected 32 files, got ${r.files.length}`)
    return `${r.files.length} files, ${r.bytes} bytes → ${r.location}`
  })
  await step('export_bundle → zip', async () => {
    const p = createProject({ canvasSize: 16, viewCount: 6, spriteName: 'TEST' })
    const collected = collectFrames(p, p.animationOrder)
    const path = await join(await appDataDir(), 'selftest-export', 'atlas.zip')
    const manifest = buildManifest(p, { format: 'atlas', animIds: p.animationOrder, options: DEFAULT_OPTIONS }, { kind: 'zip', path }, collected)
    const bundle = encodeBundle(manifest, collected.buffers, 16)
    const r = await invokeWithBytes<{ files: string[]; bytes: number; location: string }>('export_bundle', bundle)
    const st = await fs.stat(path)
    return `${r.files.join(', ')} → ${st.size} bytes zip`
  })

  const report: SelfTestReport = { ok: steps.every(s => s.ok), steps, platform: navigator.userAgent }
  try {
    await fs.writeTextFile('selftest.json', JSON.stringify(report, null, 2), { baseDir: fs.BaseDirectory.AppData })
    try { await fs.remove('selftest', { baseDir: fs.BaseDirectory.AppData }) } catch { /* marker absent */ }
  } catch { /* reporting best effort */ }
  console.log('SELFTEST', JSON.stringify(report))
  try { await invoke('selftest_done', { report: JSON.stringify(report) }) } catch { /* older backend */ }
  return report
}
