import { authoredViews, viewLabel } from '../../domain/views'
import { useEditor } from '../../store/editorStore'
import PixelCanvas from '../canvas/PixelCanvas'

/**
 * Several drawing canvases at once, one per authored view, for the studio
 * layout. Each is a full editor bound to its view; tools, colours and the
 * selected part are shared.
 */
export default function ViewGrid({ columns = 2 }: { columns?: number }) {
  const N = useEditor(s => s.doc.views.count)
  const mirror = useEditor(s => s.doc.views.mirror)
  const view = useEditor(s => s.ui.view)
  const setUi = useEditor(s => s.setUi)
  const views = authoredViews(N, mirror)
  return (
    <div className="view-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {views.map(k => (
        <div key={k} className={`view-grid__cell ${k === view ? 'is-active' : ''}`}>
          <button className="view-grid__label" onClick={() => setUi({ view: k })} title={viewLabel(N, k)}>
            <b>{k}</b> {viewLabel(N, k)}
          </button>
          <PixelCanvas embedded view={k} />
        </div>
      ))}
    </div>
  )
}
