import { useEffect, useState } from 'react'

interface Props {
  label: string
  value: number
  step?: number
  min?: number
  max?: number
  /** Called once per edit (blur / Enter / stepper), not per keystroke: one undo entry per change. */
  onCommit: (v: number) => void
  suffix?: string
  disabled?: boolean
  title?: string
  /** Rendered after the label, e.g. a keyframe toggle. */
  extra?: React.ReactNode
}

export function NumField({ label, value, step = 1, min, max, onCommit, suffix, disabled, title, extra }: Props) {
  const [text, setText] = useState(String(round(value)))
  useEffect(() => { setText(String(round(value))) }, [value])

  const commit = (raw: string) => {
    let v = Number(raw)
    if (!Number.isFinite(v)) { setText(String(round(value))); return }
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (v !== value) onCommit(v)
    setText(String(round(v)))
  }
  const bump = (d: number) => commit(String(round(Number(text) + d * step)))

  return (
    <label className="numfield" title={title}>
      <span className="numfield__label">{label}{extra}</span>
      <span className="numfield__ctl">
        <button type="button" className="numfield__btn" disabled={disabled} onClick={() => bump(-1)} aria-label={`${label} minus`}>−</button>
        <input
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onChange={e => setText(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(String(round(value))) }}
        />
        <button type="button" className="numfield__btn" disabled={disabled} onClick={() => bump(1)} aria-label={`${label} plus`}>+</button>
        {suffix && <span className="numfield__suffix">{suffix}</span>}
      </span>
    </label>
  )
}

function round(v: number): number { return Math.round(v * 100) / 100 }
