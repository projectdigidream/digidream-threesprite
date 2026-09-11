import { useEffect, useState } from 'react'

/**
 * Narrow layout below `breakpoint` px wide, or on any short screen (a phone
 * held in landscape). Layout only; hit sizes follow `(pointer: coarse)` in CSS.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px), (max-height: 520px)`
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia(query)
    const on = () => setMobile(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return mobile
}
