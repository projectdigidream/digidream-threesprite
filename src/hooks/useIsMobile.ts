import { useEffect, useState } from 'react'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/**
 * Narrow layout below `breakpoint` px wide, or on any short screen (a phone
 * held in landscape). Layout only; hit sizes follow `(pointer: coarse)` in CSS.
 */
export function useIsMobile(breakpoint = 768): boolean {
  return useMediaQuery(`(max-width: ${breakpoint - 1}px), (max-height: 520px)`)
}

/** Wider than tall: on the phone layout, a phone held sideways. */
export function useLandscape(): boolean {
  return useMediaQuery('(orientation: landscape)')
}
