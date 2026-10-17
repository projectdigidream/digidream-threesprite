import { allViews, isDerived, mirrorOf, viewAngleDeg, viewLabel } from '../../domain/views'
import { shownVariant, useEditor } from '../../store/editorStore'

/** One tab per view; derived (mirrored) views are dimmed and jump to their source when edited. */
export default function ViewStrip() {
  const N = useEditor(s => s.doc.views.count)
  const mirror = useEditor(s => s.doc.views.mirror)
  const view = useEditor(s => s.ui.view)
  const setUi = useEditor(s => s.setUi)
  const parts = useEditor(s => s.doc.parts)
  const partOrderByView = useEditor(s => s.doc.partOrderByView)
  const selectedPartId = useEditor(s => s.ui.selectedPartId)
  // the variant the canvas shows: in Animate, the animation's at the frame
  const variantId = useEditor(s => (s.ui.selectedPartId ? shownVariant(s, s.ui.selectedPartId) : null))

  const part = selectedPartId ? parts[selectedPartId] : null
  const images = part && variantId ? part.variants[variantId]?.images : null

  return (
    <div className="view-strip" role="tablist" aria-label="Views">
      {allViews(N).map(k => {
        const derived = isDerived(N, mirror, k)
        const src = derived ? mirrorOf(N, k) : k
        const has = !!images?.[src]
        const ordered = !!partOrderByView[src]
        return (
          <button
            key={k}
            role="tab"
            aria-selected={k === view}
            className={`view-tab ${k === view ? 'is-active' : ''} ${derived ? 'is-derived' : ''} ${has ? '' : 'is-empty'} ${ordered ? 'is-ordered' : ''}`}
            title={`${viewLabel(N, k)} · ${Math.round(viewAngleDeg(N, k))}°${derived ? ` · mirrored from view ${src}` : ''}${has ? '' : ' · no image for this part'}${ordered ? ' · own layer order' : ''}`}
            onClick={() => setUi({ view: k })}
          >
            <span className="view-tab__num">{k}</span>
            <span className="view-tab__label">{derived ? `⇄${src}` : shortLabel(N, k)}</span>
          </button>
        )
      })}
    </div>
  )
}

function shortLabel(N: number, k: number): string {
  const l = viewLabel(N, k)
  if (l === 'Front') return 'F'
  if (l === 'Back') return 'B'
  if (l === 'Left side') return 'L'
  if (l === 'Right side') return 'R'
  return `${Math.round(viewAngleDeg(N, k))}°`
}
