export type ViewCommandKind =
  | 'frame-all' | 'frame-selected'
  | 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom' | 'projection'
  | 'orbit-left' | 'orbit-right' | 'orbit-up' | 'orbit-down' | 'zoom-in' | 'zoom-out'
  | 'fly'

export type ViewCommand = { id: number; kind: ViewCommandKind }

/** Canvas-only key mapping. The controller also uses these commands for UI buttons. */
export function keyViewCommand(code: string, ctrl: boolean, shift: boolean): ViewCommandKind | null {
  if (code === 'Home') return 'frame-all'
  if (code === 'NumpadDecimal' || code === 'KeyF') return 'frame-selected'
  if (code === 'Numpad5') return 'projection'
  if (code === 'Numpad1') return ctrl ? 'back' : 'front'
  if (code === 'Numpad3') return ctrl ? 'left' : 'right'
  if (code === 'Numpad7') return ctrl ? 'bottom' : 'top'
  if (code === 'Numpad4') return 'orbit-left'
  if (code === 'Numpad6') return 'orbit-right'
  if (code === 'Numpad8') return 'orbit-up'
  if (code === 'Numpad2') return 'orbit-down'
  if (code === 'NumpadAdd') return 'zoom-in'
  if (code === 'NumpadSubtract') return 'zoom-out'
  if (code === 'Backquote' && shift) return 'fly'
  return null
}

/** Minecraft coordinates: +Y up, +X east, +Z south. */
export function viewDirection(kind: ViewCommandKind): [number, number, number] | null {
  switch (kind) {
    case 'front': return [0, 0, 1]
    case 'back': return [0, 0, -1]
    case 'right': return [1, 0, 0]
    case 'left': return [-1, 0, 0]
    // Tiny Z offsets keep lookAt's up vector independent of the viewing direction.
    case 'top': return [0, 1, .00001]
    case 'bottom': return [0, -1, -.00001]
    default: return null
  }
}
