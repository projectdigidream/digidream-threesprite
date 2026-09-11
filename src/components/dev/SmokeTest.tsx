import { useState } from 'react'
import { isAndroid, isTauri } from '../../core/platform'

/**
 * M0 smoke screen. Exercises the three things the rest of the app depends on
 * and that cannot be unit-tested: the Rust IPC round trip with a raw binary
 * body, the Storage Access Framework save path on Android through
 * plugin-dialog + plugin-fs, and the open/read path. Reachable later via
 * `?smoke` so it can be re-run after plugin or config changes.
 */
export default function SmokeTest() {
  const [log, setLog] = useState<string[]>([])
  const add = (line: string) => setLog(l => [...l, `${new Date().toLocaleTimeString()}  ${line}`])
  const fail = (e: unknown) => add(`ERROR ${e instanceof Error ? e.message : String(e)}`)

  async function ping() {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const r = await invoke<string>('ping')
      add(`ping → ${r}`)
    } catch (e) { fail(e) }
  }

  async function roundTrip() {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const n = 4 * 1024 * 1024
      const buf = new Uint8Array(n)
      for (let i = 0; i < n; i++) buf[i] = (i * 31 + (i >> 8)) & 0xff
      const t0 = performance.now()
      const raw = await invoke<ArrayBuffer | Uint8Array | number[]>('echo_bytes', buf)
      const ms = performance.now() - t0
      const out = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : Uint8Array.from(raw)
      let ok = out.length === n
      for (let i = 0; ok && i < n; i += 4093) ok = out[i] === buf[i]
      add(`echo_bytes 4 MB → ${out.length} bytes, ${ok ? 'MATCH' : 'MISMATCH'}, ${ms.toFixed(0)} ms, type ${raw?.constructor?.name}`)
    } catch (e) { fail(e) }
  }

  async function saveFile() {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      const path = await save({ defaultPath: 'threesprite-smoke.txt', filters: [{ name: 'Text', extensions: ['txt'] }] })
      if (!path) { add('save: cancelled'); return }
      const bytes = new TextEncoder().encode(`ThreeSprite smoke test ${new Date().toISOString()}\n`)
      await writeFile(path, bytes)
      add(`save → wrote ${bytes.length} bytes to ${path}`)
    } catch (e) { fail(e) }
  }

  async function openFile() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readFile } = await import('@tauri-apps/plugin-fs')
      const picked = await open({ multiple: false, directory: false })
      if (!picked) { add('open: cancelled'); return }
      const path = typeof picked === 'string' ? picked : String(picked)
      const data = await readFile(path)
      add(`open → read ${data.length} bytes from ${path}`)
    } catch (e) { fail(e) }
  }

  async function appData() {
    try {
      const { appDataDir } = await import('@tauri-apps/api/path')
      const { mkdir, writeTextFile, readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const dir = await appDataDir()
      await mkdir('smoke', { baseDir: BaseDirectory.AppData, recursive: true })
      await writeTextFile('smoke/hello.txt', 'hello', { baseDir: BaseDirectory.AppData })
      const back = await readTextFile('smoke/hello.txt', { baseDir: BaseDirectory.AppData })
      add(`appdata → ${dir} write/read ${back === 'hello' ? 'OK' : 'BAD'}`)
    } catch (e) { fail(e) }
  }

  const tauri = isTauri()
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif', color: '#e8ecf2' }}>
      <h2 style={{ marginTop: 0 }}>ThreeSprite smoke test</h2>
      <p style={{ opacity: 0.8 }}>
        tauri: {String(tauri)} · android: {String(isAndroid())} · dpr: {window.devicePixelRatio} · {navigator.userAgent}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button disabled={!tauri} onClick={ping}>Ping</button>
        <button disabled={!tauri} onClick={roundTrip}>IPC round trip 4 MB</button>
        <button disabled={!tauri} onClick={saveFile}>Save test file</button>
        <button disabled={!tauri} onClick={openFile}>Open a file</button>
        <button disabled={!tauri} onClick={appData}>AppData write/read</button>
        <button onClick={() => setLog([])}>Clear</button>
      </div>
      <pre style={{ marginTop: 16, whiteSpace: 'pre-wrap', fontSize: 12, background: '#0f1218', padding: 12, borderRadius: 8, minHeight: 120 }}>
        {log.join('\n') || '(no output yet)'}
      </pre>
    </div>
  )
}
