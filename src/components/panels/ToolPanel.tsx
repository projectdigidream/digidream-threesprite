import { MAX_BRUSH } from '../../core/tools/brush'
import { clampDensity, clampOffset, densityPercent, DITHER_MAX } from '../../core/tools/dither'
import { useEditor, type ToolId } from '../../store/editorStore'
import { Icon } from '../ui/Icon'

const TOOLS: { id: ToolId; icon: string; label: string; key: string }[] = [
  { id: 'pencil', icon: 'pencil', label: 'Pencil', key: 'B' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'dither', icon: 'dither', label: 'Dither', key: 'D' },
  { id: 'fill', icon: 'fill', label: 'Fill', key: 'G' },
  { id: 'eyedropper', icon: 'eyedropper', label: 'Pick colour', key: 'I' },
  { id: 'select', icon: 'select', label: 'Select', key: 'M' },
  { id: 'move', icon: 'move', label: 'Move', key: 'V' },
  { id: 'hand', icon: 'hand', label: 'Pan', key: 'H' },
]

export default function ToolPanel({ horizontal = false }: { horizontal?: boolean }) {
  const tool = useEditor(s => s.ui.tool)
  const brushSize = useEditor(s => s.ui.brushSize)
  const ditherDensity = useEditor(s => s.ui.ditherDensity)
  const ditherOffset = useEditor(s => s.ui.ditherOffset)
  const mirrorDraw = useEditor(s => s.ui.mirrorDraw)
  const ghostOthers = useEditor(s => s.ui.ghostOthers)
  const grid = useEditor(s => s.ui.grid)
  const setUi = useEditor(s => s.setUi)

  return (
    <div className={`tool-panel ${horizontal ? 'tool-panel--h' : ''}`}>
      {TOOLS.map(t => (
        <button key={t.id} className={`icon-btn ${tool === t.id ? 'is-active' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} onClick={() => setUi({ tool: t.id })}>
          <Icon name={t.icon} />
        </button>
      ))}
      <div className="tool-panel__sep" />
      <div className="tool-panel__sizes" title="Brush size">
        {Array.from({ length: MAX_BRUSH }, (_, i) => i + 1).map(n => (
          <button key={n} className={`size-btn ${brushSize === n ? 'is-active' : ''}`} onClick={() => setUi({ brushSize: n })} aria-label={`Brush size ${n}`}>
            <span style={{ width: 3 + n * 2, height: 3 + n * 2 }} />
          </button>
        ))}
      </div>
      {tool === 'dither' && (
        <>
          <div className="tool-panel__sep" />
          <div className="tool-panel__dither">
            <label title="How much of the pattern is painted. Half is a checkerboard.">
              <span>{densityPercent(ditherDensity)}%</span>
              <input
                type="range" min={0} max={DITHER_MAX} step={1} value={ditherDensity}
                aria-label="Dither density"
                onChange={e => setUi({ ditherDensity: clampDensity(Number(e.target.value)) })}
              />
            </label>
            <button
              className="size-btn dither-offset"
              title="Slide the pattern sideways, so neighbouring areas mesh instead of lining up"
              aria-label={`Dither offset ${ditherOffset}`}
              onClick={() => setUi({ ditherOffset: clampOffset(ditherOffset + 1) })}
            >→{ditherOffset}</button>
          </div>
        </>
      )}
      <div className="tool-panel__sep" />
      <button className={`icon-btn ${mirrorDraw ? 'is-active' : ''}`} title="Mirror drawing (symmetry)" aria-label="Mirror drawing" onClick={() => setUi({ mirrorDraw: !mirrorDraw })}><Icon name="mirror" /></button>
      <button className={`icon-btn ${ghostOthers ? 'is-active' : ''}`} title="Dim other parts" aria-label="Dim other parts" onClick={() => setUi({ ghostOthers: !ghostOthers })}><Icon name="eye" /></button>
      <button className={`icon-btn ${grid ? 'is-active' : ''}`} title="Pixel grid" aria-label="Pixel grid" onClick={() => setUi({ grid: !grid })}><Icon name="grid" /></button>
    </div>
  )
}
