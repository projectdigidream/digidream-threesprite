import { useMemo, useState } from 'react'
import { planExport } from '../../core/export/plan'
import { DEFAULT_OPTIONS, FORMAT_INFO, type ExportFormat, type ExportOptions, type ExportReport } from '../../core/export/types'
import { ExportCancelled, runExport, type Destination } from '../../core/io/exportRun'
import { isAndroid, isTauri } from '../../core/platform'
import { useEditor } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

const FORMATS: ExportFormat[] = ['doom', 'atlas', 'pngs', 'gif']

export default function ExportPanel() {
  const doc = useEditor(s => s.doc)
  const [format, setFormat] = useState<ExportFormat>('doom')
  const [animIds, setAnimIds] = useState<string[] | null>(null)
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_OPTIONS)
  const [busy, setBusy] = useState<string | null>(null)
  const [report, setReport] = useState<ExportReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = animIds ?? doc.animationOrder
  const sel = useMemo(() => ({ format, animIds: selected, options }), [format, selected, options])
  const plan = useMemo(() => planExport(doc, sel), [doc, sel])
  const tauri = isTauri()
  const android = isAndroid()
  const browserOk = FORMAT_INFO[format].browser

  const toggleAnim = (id: string) => setAnimIds(cur => {
    const list = cur ?? doc.animationOrder
    return list.includes(id) ? list.filter(x => x !== id) : [...doc.animationOrder.filter(x => list.includes(x) || x === id)]
  })

  const run = async (dest: Destination) => {
    setError(null)
    setReport(null)
    setBusy('Composing frames…')
    try {
      const r = await runExport(doc, sel, dest, (done, total) => setBusy(`Composing ${done}/${total}…`))
      setReport(r)
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const reveal = async () => {
    if (!report || !tauri || android) return
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
      await revealItemInDir(report.files[0] ?? report.location)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="export">
      <div className="export__col">
        <h3>Format</h3>
        <div className="export__formats">
          {FORMATS.map(f => (
            <button key={f} className={`export__format ${format === f ? 'is-active' : ''}`} onClick={() => { setFormat(f); setReport(null); setError(null) }}>
              <b>{FORMAT_INFO[f].title}</b>
              <span>{FORMAT_INFO[f].blurb}</span>
              {!tauri && !FORMAT_INFO[f].browser && <em>Desktop / Android app only</em>}
            </button>
          ))}
        </div>

        <h3>Animations</h3>
        <div className="export__anims">
          {doc.animationOrder.map(id => {
            const a = doc.animations[id]
            return (
              <label key={id} className="field--row">
                <input type="checkbox" checked={selected.includes(id)} onChange={() => toggleAnim(id)} />
                <span>{a.name} <small>({a.frameCount} frames · {a.fps} fps{a.loop ? '' : ' · once'})</small></span>
              </label>
            )
          })}
        </div>

        <h3>Options</h3>
        <div className="export__options">
          {format === 'doom' && (
            <label className="field--row" title="When the view count is not 1, 8 or 16, export only the front view as rotation 0">
              <input type="checkbox" checked={options.doomFrontOnly} onChange={e => setOptions({ ...options, doomFrontOnly: e.target.checked })} />
              <span>Front view only (rotation 0)</span>
            </label>
          )}
          {format === 'atlas' && (
            <label className="field--row">
              <input type="checkbox" checked={options.atlasPow2} onChange={e => setOptions({ ...options, atlasPow2: e.target.checked })} />
              <span>Power-of-two sheet height</span>
            </label>
          )}
          {format === 'gif' && (
            <label className="field field--row">
              <span>Turntable fps</span>
              <input inputMode="decimal" style={{ width: 70 }} value={options.turntableFps} onChange={e => setOptions({ ...options, turntableFps: Number(e.target.value) || 4 })} />
            </label>
          )}
          <small>Canvas {doc.canvas.size}px · {plan.viewCount} views{doc.views.mirror ? ' (mirrored views are written as real files)' : ''} · {plan.frameCount} frames → {plan.files.length} files</small>
        </div>
      </div>

      <div className="export__col">
        <h3>Files</h3>
        {plan.errors.length > 0 && <div className="warning"><b>Cannot export:</b><ul>{plan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        {plan.warnings.length > 0 && <div className="warning"><ul>{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
        <pre className="export__files">{plan.files.slice(0, 40).map(f => f.name).join('\n')}{plan.files.length > 40 ? `\n… ${plan.files.length - 40} more` : ''}</pre>

        <div className="export__actions">
          {tauri && !android && <button className="primary" disabled={!!busy || plan.errors.length > 0} onClick={() => run('dir')}><Icon name="folder" size={16} /> Export to folder…</button>}
          {tauri && <button className={android ? 'primary' : ''} disabled={!!busy || plan.errors.length > 0} onClick={() => run('zip')}><Icon name="save" size={16} /> {android ? 'Save zip…' : 'Export as zip…'}</button>}
          {!tauri && <button className="primary" disabled={!!busy || plan.errors.length > 0 || !browserOk} onClick={() => run('zip')}><Icon name="export" size={16} /> Download zip</button>}
          {busy && <span className="export__busy">{busy}</span>}
        </div>
        {error && <div className="warning"><b>Export failed:</b> {error}</div>}
        {report && (
          <div className="export__report">
            <b>Exported {report.files.length} files ({(report.bytes / 1024).toFixed(1)} KB)</b>
            <div className="export__location">{report.location}</div>
            {report.warnings.length > 0 && <ul className="warning">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            {tauri && !android && <button className="text-btn" onClick={reveal}>Reveal in file manager</button>}
          </div>
        )}
      </div>
    </div>
  )
}
