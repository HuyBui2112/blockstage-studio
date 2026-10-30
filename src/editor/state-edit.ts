import { validateState, type Material } from '../core/catalog'
import type { EditorObject } from './model'
import { isStructuralStateProperty } from './placement'

export type SharedStateField = { property: string; values: string[]; value: string | null }
export type SharedStateFields = { fields: SharedStateField[]; reason: string | null }

// Cross-ID adapters describe state-edit semantics, not world behavior or safe
// material replacement. Unknown semantics stay editable only within one ID.
const sharedSemantics: Record<string, readonly string[]> = {
  axis: ['x', 'y', 'z'], facing: ['north', 'east', 'south', 'west', 'up', 'down'],
  rotation: Array.from({ length: 16 }, (_, i) => String(i)), waterlogged: ['true', 'false'],
  half: ['top', 'bottom'], type: ['top', 'bottom', 'double'],
}
function semantics(property: string, values: readonly string[]): string | undefined {
  const domain = Object.hasOwn(sharedSemantics, property) ? sharedSemantics[property] : undefined
  return domain && values.length > 0 && values.every(value => domain.includes(value)) ? property : undefined
}

/** All selected logical leaves participate. Never silently skip group children,
 * unavailable registry data or cells whose state differs from the active cell.
 */
export function sharedStateFields(objects: readonly EditorObject[], catalog: readonly Material[]): SharedStateFields {
  if (!objects.length) return { fields: [], reason: 'Select a block to edit its state' }
  if (objects.some(object => !['block', 'multiblock'].includes(object.kind) || object.children.length)) {
    return { fields: [], reason: 'Select blocks or multi-blocks; groups and components keep their own scope' }
  }
  const cells = objects.flatMap(object => object.cells)
  if (!cells.length || objects.some(object => !object.cells.length)) return { fields: [], reason: 'Selection has no editable block cells' }
  const registry = new Map(catalog.map(material => [material.id, material]))
  const materials: Material[] = []
  for (const cell of cells) {
    const material = registry.get(cell.state.name)
    if (!material) return { fields: [], reason: `Registry unavailable for ${cell.state.name}` }
    try { validateState(cell.state, [material]) }
    catch { return { fields: [], reason: `Invalid state in selection: ${cell.state.name}` } }
    materials.push(material)
  }
  const sameId = cells.every(cell => cell.state.name === cells[0].state.name)
  const fields: SharedStateField[] = []
  for (const [property, firstValues] of Object.entries(materials[0].properties)) {
    if (cells.some(cell => isStructuralStateProperty(cell.state, property))) continue
    const domains = materials.map(material => material.properties[property])
    if (domains.some(values => !values)) continue
    if (!sameId) {
      const semantic = semantics(property, firstValues)
      if (!semantic || cells.some(cell => !cell.state.name.startsWith('minecraft:')) || domains.some(values => semantics(property, values) !== semantic)) continue
    }
    const values = firstValues.filter(value => domains.every(domain => domain.includes(value)))
    if (!values.length) continue
    const first = cells[0].state.properties[property]
    fields.push({ property, values, value: cells.every(cell => cell.state.properties[property] === first) ? first : null })
  }
  return { fields, reason: fields.length ? null : 'No compatible shared state properties' }
}
