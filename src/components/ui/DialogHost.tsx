import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { dialogStore, resolveCurrent } from '../../core/ui/dialogs'

/** Renders the queued in-app prompt / confirm / notice dialogs, one at a time. */
export default function DialogHost() {
  const req = useStore(dialogStore, s => s.queue[0])
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(req?.kind === 'prompt' ? req.defaultValue : '')
    if (req?.kind === 'prompt') setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
  }, [req])

  // Escape cancels wherever the focus is, and never reaches the editor's own Escape handlers.
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      resolveCurrent(req.kind === 'prompt' || req.kind === 'choice' ? null : req.kind === 'confirm' ? false : undefined)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])

  if (!req) return null
  const ok = () => resolveCurrent(req.kind === 'prompt' ? text : req.kind === 'confirm' ? true : req.kind === 'choice' ? null : undefined)
  const cancel = () => resolveCurrent(req.kind === 'prompt' || req.kind === 'choice' ? null : req.kind === 'confirm' ? false : undefined)

  return (
    <div className="modal-backdrop modal-backdrop--top" onClick={cancel}>
      <div
        className="modal modal--small"
        role={req.kind === 'notice' ? 'alertdialog' : 'dialog'}
        aria-label={req.title}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') cancel()
          else if (e.key === 'Enter') ok()
        }}
      >
        <h3 className="modal__title">{req.title}</h3>
        {req.kind !== 'prompt' && req.message && <p className="modal__message">{req.message}</p>}
        {req.kind === 'prompt' && (
          <label className="field">
            {req.label && <span>{req.label}</span>}
            <input ref={inputRef} value={text} placeholder={req.placeholder} onChange={e => setText(e.target.value)} />
          </label>
        )}
        {req.kind === 'choice' && (
          <div className="choice-cards" role="listbox" aria-label={req.title}>
            {req.options.map(o => <button key={o} role="option" className="choice-card" onClick={() => resolveCurrent(o)}><b>{o}</b></button>)}
          </div>
        )}
        <div className="modal__actions">
          {req.kind !== 'notice' && <button onClick={cancel}>Cancel</button>}
          {req.kind !== 'choice' && (
            <button className={req.kind === 'confirm' && req.danger ? 'danger' : 'primary'} onClick={ok} autoFocus={req.kind !== 'prompt'}>
              {req.kind === 'notice' ? 'Close' : req.okLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
