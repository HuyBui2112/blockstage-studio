import { BoxGeometry, Matrix4 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { BlockState } from '../core/schema'

export function blockGeometry(state: BlockState) {
  const p = state.properties
  if (state.name.endsWith('_slab') && p.type !== 'double') return new BoxGeometry(1, .5, 1).translate(0, p.type === 'top' ? .25 : -.25, 0)
  if (state.name.endsWith('_stairs') && p.shape === 'straight') {
    const top = p.half === 'top'
    const base = new BoxGeometry(1, .5, 1).translate(0, top ? .25 : -.25, 0)
    // north-facing stairs ascend toward -Z.
    const step = new BoxGeometry(1, .5, .5).translate(0, top ? -.25 : .25, -.25)
    const result = mergeGeometries([base, step], true)!
    // Reassign groups to six cube materials rather than one material per box.
    result.clearGroups()
    for (let b = 0; b < 2; b++) for (let f = 0; f < 6; f++) result.addGroup(b * 36 + f * 6, 6, f)
    base.dispose(); step.dispose()
    const facing = ['north', 'east', 'south', 'west'].indexOf(p.facing)
    result.applyMatrix4(new Matrix4().makeRotationY(-Math.max(0, facing) * Math.PI / 2))
    return result
  }
  return new BoxGeometry(1, 1, 1)
}
