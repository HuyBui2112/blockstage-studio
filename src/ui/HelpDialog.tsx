import { Dialog } from './Dialog'

const controls = [
  ['Middle mouse drag', 'Orbit around the asset'],
  ['Shift + middle mouse', 'Pan'],
  ['Wheel / Ctrl + middle mouse', 'Zoom toward the pointer'],
  ['Home / F / Numpad .', 'Frame the asset'],
  ['Numpad 1 / 3 / 7', '2D front / right / top (orthographic)'],
  ['Ctrl + Numpad 1 / 3 / 7', '2D back / left / bottom (orthographic)'],
  ['Numpad 2 / 4 / 6 / 8', 'Orbit in steps'],
  ['Numpad 5', 'Perspective / orthographic'],
  ['G / R', 'Move / rotate preview · numeric input'],
  ['R / Shift + R while placing', 'Rotate placement +90° / −90° · no document change'],
  ['Esc while placing', 'Cancel placement and return to Select'],
  ['X / Y / Z during move', 'Axis constraint · Shift excludes an axis'],
  ['Enter / Esc during transform', 'Commit / cancel · one undo action'],
  ['Shift + click / B', 'Toggle selection / through box select'],
  ['Click in Select mode', 'Select the nearest occupied block cell, including thin models'],
  ['Ctrl + G / Ctrl + Alt + G', 'Group / ungroup'],
  ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
  ['Ctrl + S / Delete', 'Save document / delete selection'],
  ['Shift + `', 'Fly · WASD, Q/E, Shift to accelerate'],
  ['Esc', 'Exit fly / close a dialog'],
]

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title="Navigation help" onClose={onClose} className="help-dialog"><div className="dialog-content"><p className="compact-note muted">Focus the viewport to use shortcuts. Camera buttons work without a numpad.</p><table className="shortcut-table"><tbody>{controls.map(([key, action]) => <tr key={key}><th><kbd>{key}</kbd></th><td>{action}</td></tr>)}</tbody></table><details className="quiet-details"><summary>Coordinates & preview</summary><p>Minecraft coordinates: +X east, +Y up, +Z south. Front looks north (−Z). One unit is one block. This isolated preview never changes your saved projects.</p><p>Block state controls show legal registry values. Context derives supported orientation fields. Support checks are limited; physics and world updates are not simulated. Entity previews use the supported static pose.</p></details></div></Dialog>
}
