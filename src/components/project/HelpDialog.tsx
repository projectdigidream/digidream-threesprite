const SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Drawing',
    rows: [
      ['B / E / D', 'Pencil / eraser / dither'],
      ['G / I', 'Fill / colour picker'],
      ['Dither density, offset', 'Coverage of the pattern, and sliding it sideways to mesh'],
      ['M / V / H', 'Select / move / pan'],
      ['X', 'Swap primary and secondary colours'],
      ['Right-click · long-press', 'Pick the colour under the pointer'],
      ['Shift-click a swatch', 'Set the secondary colour'],
      ['Delete / Backspace', 'Clear the selection'],
      ['Esc', 'Drop the selection, cancel a stroke'],
      ['+ / − / 0 · Ctrl+wheel · pinch', 'Zoom in / out / fit · zoom about the pointer'],
      ['Space+drag · middle button · wheel', 'Pan'],
    ],
  },
  {
    title: 'Views and frames',
    rows: [
      [', / .', 'Previous / next view'],
      ['[ / ]', 'Previous / next frame'],
      ['Space', 'Play / pause (Animate and 3D tabs)'],
    ],
  },
  {
    title: 'Rig and animation',
    rows: [
      ['Drag a bone root', 'Move it (rest pose in Rig, a move key in Animate)'],
      ['Drag a bone tip', 'Rotate it · hold Shift to change its length'],
      ['Drag the pink cross', 'Move where the selected part hangs on its bone'],
      ['Pencil in the Bones panel', 'Draw a new bone: press at the root, drag to the tip'],
      ['Drag a timeline key', 'Move it · right-click / long-press deletes it'],
      ['Click a key · Shift-click', 'Select it · add another to the selection'],
      ['Multi-select button', 'Tap keys to select them, for touch screens'],
      ['Ctrl+C · Ctrl+V', 'Copy the selected keys · paste them at the playhead'],
    ],
  },
  {
    title: 'Project',
    rows: [
      ['Ctrl+Z · Shift+Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+S · Shift+Ctrl+S', 'Save · save as'],
      ['Ctrl+O · Ctrl+N', 'Open · new project'],
    ],
  },
]

export default function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--wide" onClick={e => e.stopPropagation()} role="dialog" aria-label="Help">
        <h2>Shortcuts and gestures</h2>
        {SECTIONS.map(s => (
          <section key={s.title} className="help__section">
            <h4>{s.title}</h4>
            <table className="help__table">
              <tbody>
                {s.rows.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
              </tbody>
            </table>
          </section>
        ))}
        <p className="help__note">Views: view 1 faces the viewer; views go anticlockwise around the character seen from above. Every frame is drawn on the square canvas with the feet on the bottom row.</p>
        <div className="modal__actions"><button className="primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
