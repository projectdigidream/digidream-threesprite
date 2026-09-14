const PATHS: Record<string, string> = {
  pencil: 'M3 21l3.5-.9L19 7.6 16.4 5 3.9 17.5 3 21z M14 7l3 3',
  eraser: 'M16 3l5 5-9.5 9.5H7L3 13.5 16 3z M9 21h12 M7 17.5l-4-4',
  fill: 'M4 13l7-7 7 7-7 7-7-7z M11 6V3 M20 16c0 1.7 1 3 1 3s1-1.3 1-3-1-2-1-2-1 .3-1 2z',
  eyedropper: 'M3 21l1-4 9-9 3 3-9 9-4 1z M13 8l2-2 3 3-2 2 M15 3l2-2 5 5-2 2',
  select: 'M4 4h4 M10 4h4 M20 4v4 M20 10v4 M20 20h-4 M14 20h-4 M4 20v-4 M4 14v-4',
  move: 'M12 2v20 M2 12h20 M8 6l4-4 4 4 M8 18l4 4 4-4 M6 8l-4 4 4 4 M18 8l4 4-4 4',
  hand: 'M8 13V5a2 2 0 014 0v6 M12 11V4a2 2 0 014 0v7 M16 11V6a2 2 0 014 0v8a7 7 0 01-7 7h-1a7 7 0 01-6-3.5l-3-5a2 2 0 013.5-2L8 14',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 000 12h3',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M9 9h6v6H9z',
  swap: 'M7 4v12 M3 12l4 4 4-4 M17 20V8 M13 12l4-4 4 4',
  mirror: 'M12 3v18 M8 7l-5 5 5 5 M16 7l5 5-5 5',
  grid: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z',
  settings: 'M12 8a4 4 0 100 8 4 4 0 000-8z M4 12h-2 M22 12h-2 M12 4V2 M12 22v-2 M6.3 6.3L4.9 4.9 M19.1 19.1l-1.4-1.4 M6.3 17.7l-1.4 1.4 M19.1 4.9l-1.4 1.4',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  up: 'M12 19V5 M5 12l7-7 7 7',
  down: 'M12 5v14 M5 12l7 7 7-7',
  check: 'M4 12l5 5L20 7',
  close: 'M6 6l12 12 M18 6L6 18',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h4v16H7z M13 4h4v16h-4z',
  bone: 'M6 6a2 2 0 103 3l6 6a2 2 0 103-3 2 2 0 10-3-3L9 3a2 2 0 10-3 3z',
  layers: 'M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  cube: 'M12 2l9 5v10l-9 5-9-5V7l9-5z M12 22V12 M3 7l9 5 9-5',
  export: 'M12 3v12 M8 7l4-4 4 4 M4 15v4h16v-4',
  film: 'M4 4h16v16H4z M4 9h16 M4 15h16 M9 4v16 M15 4v16',
  copy: 'M8 8h12v12H8z M16 8V4H4v12h4',
  paste: 'M8 5H5v16h14V5h-3 M9 3h6v4H9z',
  onion: 'M12 3a7 7 0 017 7c0 5-7 11-7 11S5 15 5 10a7 7 0 017-7z M12 7a3 3 0 100 6 3 3 0 000-6z',
  new: 'M6 2h9l5 5v15H6z M15 2v5h5 M12 11v6 M9 14h6',
  save: 'M4 4h13l3 3v13H4z M8 4v5h7V4 M8 20v-6h8v6',
  folder: 'M3 6h6l2 2h10v12H3z',
  palette: 'M12 3a9 9 0 100 18c1.3 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-8-9-8z M7.5 11a1 1 0 100 2 1 1 0 000-2z M10.5 7a1 1 0 100 2 1 1 0 000-2z M15 7.5a1 1 0 100 2 1 1 0 000-2z',
  sort: 'M4 6h16 M4 12h10 M4 18h5',
  left: 'M19 12H5 M11 6l-6 6 6 6',
  right: 'M5 12h14 M13 6l6 6-6 6',
  import: 'M12 3v12 M8 11l4 4 4-4 M4 17v3h16v-3',
}

interface Props { name: keyof typeof PATHS | string; size?: number; className?: string }

/** Small stroke icon set, currentColor. */
export function Icon({ name, size = 18, className }: Props) {
  const d = PATHS[name] ?? PATHS.close
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
