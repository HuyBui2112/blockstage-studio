import type { CSSProperties } from 'react'

export type IconName = 'cube' | 'blocks' | 'entity' | 'search' | 'close' | 'plus' | 'check' | 'chevron' | 'chevron-up' | 'chevron-down' | 'arrow-up' | 'arrow-down' | 'folder' | 'layers' | 'settings' | 'help' | 'grid' | 'frame' | 'orbit' | 'pan' | 'zoom-in' | 'zoom-out' | 'perspective' | 'sun' | 'eye' | 'eye-off' | 'trash' | 'upload' | 'file' | 'warning' | 'info' | 'refresh' | 'external' | 'menu' | 'sliders' | 'keyboard' | 'select' | 'box-select' | 'ungroup' | 'architecture' | 'save' | 'undo' | 'redo'

  | 'rename'

const paths: Record<IconName, React.ReactNode> = {
  rename: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" /></>,
  select: <path d="m5 3 15 10-8 1-4 7-3-18Z" />,
  'box-select': <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M11 3h2M3 11v2m18-2v2m-10 8h2" /><path d="m9 9 10 6-5 1-2 4-3-11Z" /></>,
  ungroup: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><path d="m5 15-3 3 3 3m13-18 3 3-3 3M2 18h7m6-12h6" /></>,
  architecture: <><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7M9 10h6" /></>,
  save: <><path d="M3 3h15l3 3v15H3V3Zm4 0v7h10V3M7 21v-7h10v7" /><path d="M14 4v4" /></>,
  undo: <><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14" /></>,
  redo: <><path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14" /></>,
  cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9m-4-15.8 8 4.5"/></>,
  blocks: <><path d="m8 3 5 3v6l-5 3-5-3V6l5-3Zm8 6 5 3v6l-5 3-5-3v-6"/><path d="m3 6 5 3 5-3M8 9v6m5-5 3 2 5 0M16 12v9"/></>,
  entity: <><circle cx="12" cy="6" r="3"/><path d="M7 21v-5H4l2-6h12l2 6h-3v5M9 11v4m6-4v4"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  'chevron-up': <path d="m5 15 7-7 7 7"/>,
  'chevron-down': <path d="m5 9 7 7 7-7"/>,
  'arrow-up': <path d="M12 20V4m-6 6 6-6 6 6"/>,
  'arrow-down': <path d="M12 4v16m-6-6 6 6 6-6"/>,
  folder: <path d="M3 7V5h6l2 2h10v13H3V7Zm0 3h18"/>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></>,
  settings: <><path d="m9 3-.5 3-2 1L4 6 2 10l2.5 2v2L2 16l2 4 3-1 2 1 .5 2h5l.5-2 2-1 3 1 2-4-2.5-2v-2L22 10l-2-4-2.5 1-2-1L15 3H9Z"/><circle cx="12" cy="12.5" r="3"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 16h.01"/></>,
  grid: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></>,
  frame: <><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><rect x="8" y="8" width="8" height="8" rx="1"/></>,
  orbit: <><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="2"/><path d="m17 3 3 1-1 3"/></>,
  pan: <path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>,
  'zoom-in': <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/></>,
  'zoom-out': <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/></>,
  perspective: <><path d="m3 6 18-3v18L3 18V6Zm0 4 18-2M3 14l18 2M9 5v14M15 4v16"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
  eye: <><path d="M2 12S6 5 12 5s10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  'eye-off': <><path d="m3 3 18 18M9 5.5a10 10 0 0 1 3-.5c6 0 10 7 10 7a22 22 0 0 1-3 3.5M6 6.5A23 23 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/></>,
  file: <><path d="M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8m-8 4h8"/></>,
  warning: <><path d="m12 3 10 18H2L12 3ZM12 9v5m0 3h.01"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
  refresh: <><path d="M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5M4 16a9 9 0 0 0 15 3l3-3m0 5v-5h-5"/></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  sliders: <><path d="M4 6h8m4 0h4M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>,
  keyboard: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10"/></>,
}

export function Icon({ name, size = 18, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>
}
