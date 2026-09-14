import type { ReactNode } from 'react'

/**
 * Explanatory prose inside a panel: what a control means, how a gesture works.
 * Hidden on phones (see `.mobile .hint`), where the panels are short and the
 * room is better spent on the controls themselves. Text that says why an area
 * is empty is not a hint — write that as plain copy so it always shows.
 */
export function Hint({ children }: { children: ReactNode }) {
  return <small className="hint">{children}</small>
}
