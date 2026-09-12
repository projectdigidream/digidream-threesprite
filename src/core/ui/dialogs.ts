/**
 * In-app prompt / confirm / notice dialogs. Native `window.prompt` and friends
 * are not implemented by the desktop and Android webviews (they return null
 * silently), so every question the app asks goes through this queue and is
 * rendered by `DialogHost`. The functions resolve when the user answers.
 */
import { createStore } from 'zustand/vanilla'

export type DialogRequest =
  | { kind: 'prompt'; title: string; label?: string; defaultValue: string; placeholder?: string; okLabel: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message?: string; okLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'notice'; title: string; message?: string; resolve: () => void }

export const dialogStore = createStore<{ queue: DialogRequest[] }>(() => ({ queue: [] }))

function enqueue(req: DialogRequest): void {
  dialogStore.setState(s => ({ queue: [...s.queue, req] }))
}

/** Ask for a line of text. Resolves with the trimmed text, or null when cancelled. */
export function askText(title: string, opts: { defaultValue?: string; label?: string; placeholder?: string; okLabel?: string } = {}): Promise<string | null> {
  return new Promise(resolve => enqueue({ kind: 'prompt', title, label: opts.label, defaultValue: opts.defaultValue ?? '', placeholder: opts.placeholder, okLabel: opts.okLabel ?? 'OK', resolve }))
}

/** Yes/no question. Resolves true when confirmed. */
export function askConfirm(title: string, opts: { message?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => enqueue({ kind: 'confirm', title, message: opts.message, okLabel: opts.okLabel ?? 'OK', danger: opts.danger ?? false, resolve }))
}

/** A message with a single Close button. */
export function notice(title: string, message?: string): Promise<void> {
  return new Promise(resolve => enqueue({ kind: 'notice', title, message, resolve }))
}

/** Answer the dialog at the head of the queue (called by the host). */
export function resolveCurrent(value: unknown): void {
  const cur = dialogStore.getState().queue[0]
  if (!cur) return
  dialogStore.setState(s => ({ queue: s.queue.slice(1) }))
  if (cur.kind === 'prompt') cur.resolve(typeof value === 'string' ? value.trim() : null)
  else if (cur.kind === 'confirm') cur.resolve(value === true)
  else cur.resolve()
}
