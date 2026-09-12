import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  /** Called once with the trimmed new name when it changed (Enter or blur). */
  onCommit: (name: string) => void
  placeholder?: string
  title?: string
  /** Focus and select the text when this changes to a new truthy value (e.g. a click counter). */
  focusKey?: number
  className?: string
}

/** A text field for a name that commits on Enter / blur and reverts on Escape, so renames are one undo step. */
export function InlineName({ value, onCommit, placeholder, title, focusKey, className }: Props) {
  const [text, setText] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const cancelledRef = useRef(false)
  useEffect(() => { setText(value) }, [value])
  useEffect(() => {
    if (focusKey) { ref.current?.focus(); ref.current?.select() }
  }, [focusKey])
  const commit = () => {
    if (cancelledRef.current) { cancelledRef.current = false; setText(value); return }
    const name = text.trim()
    if (name && name !== value) onCommit(name)
    else setText(value)
  }
  return (
    <input
      ref={ref}
      className={`inline-name ${className ?? ''}`}
      value={text}
      placeholder={placeholder}
      title={title ?? 'Rename (Enter to apply, Esc to cancel)'}
      aria-label={title ?? 'Name'}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        else if (e.key === 'Escape') { cancelledRef.current = true; setText(value); (e.target as HTMLInputElement).blur() }
      }}
    />
  )
}
