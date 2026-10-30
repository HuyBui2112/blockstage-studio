import { rotatePos, rotateState, bounds } from '../core/assembly'
import type { Material } from '../core/catalog'
import type { BlockState, SceneBlock, Vec3 } from '../core/schema'
import { componentAssetSchema, objectCells, validateDocument, type ComponentAsset, type CoordinateSpace, type EditorDocument, type EditorObject, type PivotMode, type QuarterTurn } from './model'
import { isStructuralStateProperty, rewriteLogicalState } from './placement'
import { sharedStateFields } from './state-edit'
import type { NeighborRules } from '../core/profile'
import { planNeighborConnections } from './neighbors'

function selected(document: EditorDocument, ids: string[]): EditorObject[] {
  if (!ids.length) throw new Error('Select at least one object')
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate selection ID')
  const index = new Map(document.objects.map(object => [object.id, object]))
  return ids.map(id => {
    const object = index.get(id)
    if (!object) throw new Error('Selected object is missing; ungroup to edit children')
    return object
  })
}
function commit(document: EditorDocument, objects: EditorObject[], catalog: Material[]): EditorDocument {
  const result = { ...document, objects }
  validateDocument(result, catalog)
  return result
}
function integerVector(vector: Vec3) {
  if (vector.length !== 3 || vector.some(value => !Number.isSafeInteger(value))) throw new Error('Transform requires integer cell coordinates')
}
function moveObject(object: EditorObject, delta: Vec3): EditorObject {
  return {
    ...object, pivot2: object.pivot2.map((value, axis) => value + 2 * delta[axis]) as Vec3,
    cells: object.cells.map(cell => ({ ...cell, pos: cell.pos.map((value, axis) => value + delta[axis]) as Vec3 })),
    children: object.children.map(child => moveObject(child, delta)),
  }
}
function turnsValue(turns: number): QuarterTurn {
  if (!Number.isSafeInteger(turns)) throw new Error('Rotation requires whole quarter turns')
  return ((turns % 4 + 4) % 4) as QuarterTurn
}
function safeRotateState(state: BlockState, turns: QuarterTurn): BlockState {
  // A registry proves state legality, not how an unfamiliar orientation transforms.
  for (const [property, value] of Object.entries(state.properties)) {
    if (property === 'orientation') throw new Error('This block needs a specialized rotation adapter')
    if (['north', 'east', 'south', 'west', 'x', 'y', 'z'].includes(value) && !['facing', 'axis', 'north', 'east', 'south', 'west'].includes(property)) throw new Error(`Rotation adapter does not support ${property}`)
    if (property === 'rotation' && !/^(?:[0-9]|1[0-5])$/.test(value)) throw new Error('Rotation adapter requires a 16-step block rotation')
  }
  return rotateState(state, turns)
}
function rotatePoint2(point: Vec3, pivot2: Vec3, turns: QuarterTurn): Vec3 {
  const relative = point.map((value, axis) => value - pivot2[axis]) as Vec3
  return rotatePos(relative, turns).map((value, axis) => value + pivot2[axis]) as Vec3
}
function rotateObject(object: EditorObject, pivot2: Vec3, turns: QuarterTurn): EditorObject {
  return {
    ...object, pivot2: rotatePoint2(object.pivot2, pivot2, turns), orientation: ((object.orientation + turns) % 4) as QuarterTurn,
    cells: object.cells.map(cell => {
      const center2 = cell.pos.map(value => value * 2 + 1) as Vec3
      const nextCenter = rotatePoint2(center2, pivot2, turns)
      if (nextCenter.some(value => value % 2 === 0)) throw new Error('Pivot parity would move cells off the integer grid')
      return { ...cell, pos: nextCenter.map(value => (value - 1) / 2) as Vec3, state: safeRotateState(cell.state, turns) }
    }), children: object.children.map(child => rotateObject(child, pivot2, turns)),
  }
}
export function selectionPivot2(document: EditorDocument, ids: string[], mode: PivotMode): Vec3 {
  const objects = selected(document, ids)
  if (mode !== 'selection') return [...objects[objects.length - 1].pivot2] as Vec3
  const box = bounds(objects.flatMap(objectCells))
  return box.min.map((value, axis) => 2 * value + box.size[axis]) as Vec3
}
export function insertObject(document: EditorDocument, object: EditorObject, catalog: Material[]): EditorDocument {
  return commit(document, [...document.objects, structuredClone(object)], catalog)
}
export function removeObjects(document: EditorDocument, ids: string[], catalog: Material[]): EditorDocument {
  selected(document, ids)
  const remove = new Set(ids)
  return commit(document, document.objects.filter(object => !remove.has(object.id)), catalog)
}
export function moveObjects(document: EditorDocument, ids: string[], delta: Vec3, space: CoordinateSpace, catalog: Material[]): EditorDocument {
  return moveCandidate(document, ids, delta, space, catalog, true)
}
function moveCandidate(document: EditorDocument, ids: string[], delta: Vec3, space: CoordinateSpace, catalog: Material[], validate: boolean): EditorDocument {
  integerVector(delta)
  const objects = selected(document, ids), chosen = new Set(ids)
  const translated = space === 'local' ? rotatePos(delta, objects[objects.length - 1].orientation) : delta
  if (translated.every(value => value === 0)) return document
  const result = { ...document, objects: document.objects.map(object => chosen.has(object.id) ? moveObject(object, translated) : object) }
  if (validate) validateDocument(result, catalog)
  return result
}
export function rotateObjects(document: EditorDocument, ids: string[], turns: number, pivotMode: PivotMode, catalog: Material[]): EditorDocument {
  return rotateCandidate(document, ids, turns, pivotMode, catalog, true)
}
function rotateCandidate(document: EditorDocument, ids: string[], turns: number, pivotMode: PivotMode, catalog: Material[], validate: boolean): EditorDocument {
  selected(document, ids)
  const t = turnsValue(turns), chosen = new Set(ids)
  if (!t) return document
  const pivot = selectionPivot2(document, ids, pivotMode)
  const result = { ...document, objects: document.objects.map(object => chosen.has(object.id) ? rotateObject(object, pivotMode === 'individual' ? object.pivot2 : pivot, t) : object) }
  if (validate) validateDocument(result, catalog)
  return result
}
export type TransformIntent = { kind: 'move'; delta: Vec3 } | { kind: 'rotate'; turns: number }
export type TransformPreview = { document: EditorDocument | null; blocks: SceneBlock[]; valid: boolean; error: string | null }
export function previewTransform(document: EditorDocument, ids: string[], intent: TransformIntent, space: CoordinateSpace, pivotMode: PivotMode, catalog: Material[], rules?: NeighborRules): TransformPreview {
  let candidate: EditorDocument
  let neighbors: SceneBlock[] = []
  try {
    candidate = intent.kind === 'move' ? moveCandidate(document, ids, intent.delta, space, catalog, false) : rotateCandidate(document, ids, intent.turns, pivotMode, catalog, false)
    if(rules){const plan=planNeighborConnections(document,candidate,rules);candidate=plan.document;neighbors=plan.changed}
  } catch (error) { return { document: null, blocks: [], valid: false, error: error instanceof Error ? error.message : 'Invalid transform' } }
  const chosen = new Set(ids)
  const blocks = [...candidate.objects.filter(object => chosen.has(object.id)).flatMap(object => objectCells(object).map(cell => ({ ...cell, owner: object.id }))),...neighbors.filter(block=>!chosen.has(block.owner))]
  try { validateDocument(candidate, catalog); return { document: candidate, blocks, valid: true, error: null } }
  catch (error) { return { document: null, blocks, valid: false, error: error instanceof Error ? error.message : 'Invalid transform' } }
}
export function groupObjects(document: EditorDocument, ids: string[], name: string, catalog: Material[]): EditorDocument {
  const objects = selected(document, ids), chosen = new Set(ids)
  if (objects.length < 2) throw new Error('Select at least two objects to group')
  const children = document.objects.filter(object => chosen.has(object.id))
  const group: EditorObject = { id: crypto.randomUUID(), name, kind: 'group', cells: [], children, pivot2: selectionPivot2(document, ids, 'selection'), orientation: 0 }
  const result: EditorObject[] = []
  let added = false
  for (const object of document.objects) {
    if (!chosen.has(object.id)) result.push(object)
    else if (!added) { result.push(group); added = true }
  }
  return commit(document, result, catalog)
}
export function ungroupObjects(document: EditorDocument, ids: string[], catalog: Material[]): EditorDocument {
  const objects = selected(document, ids), chosen = new Set(ids)
  if (objects.some(object => object.kind !== 'group')) throw new Error('Only groups can be ungrouped')
  return commit(document, document.objects.flatMap(object => chosen.has(object.id) ? object.children : [object]), catalog)
}
export function updateObjectState(document: EditorDocument, id: string, property: string, value: string, catalog: Material[]): EditorDocument {
  return updateObjectsState(document, [id], property, value, catalog)
}
/** Plan every rewrite against the original document, then validate once. Bed
 * footprints can exchange vacated cells; any final collision rejects the batch.
 */
export function updateObjectsState(document: EditorDocument, ids: string[], property: string, value: string, catalog: Material[]): EditorDocument {
  const objects = selected(document, ids)
  if (objects.some(object => object.cells.some(cell => isStructuralStateProperty(cell.state, property)))) throw new Error('Edit the whole logical object; part/half cannot be changed separately')
  const common = sharedStateFields(objects, catalog)
  const field = common.fields.find(field => field.property === property)
  if (!field || !field.values.includes(value)) throw new Error(common.reason ?? `No compatible shared value for ${property}`)
  if (field.value === value) return document
  const updated = new Map(objects.map(object => [object.id, rewriteLogicalState(object, property, value, catalog)]))
  return commit(document, document.objects.map(object => updated.get(object.id) ?? object), catalog)
}
/** Explicit re-anchor changes only object pivots; Minecraft cells stay untouched. */
export function setObjectPivot(document: EditorDocument, id: string, pivot2: Vec3, catalog: Material[]): EditorDocument {
  const [object] = selected(document, [id])
  integerVector(pivot2)
  return commit(document, document.objects.map(current => current.id === object.id ? { ...current, pivot2: [...pivot2] as Vec3 } : current), catalog)
}
export function componentFromSelection(document: EditorDocument, ids: string[], name: string): ComponentAsset {
  const objects = selected(document, ids)
  const box = bounds(objects.flatMap(objectCells))
  const delta = box.min.map(value => -value) as Vec3
  const pivot2 = selectionPivot2(document, ids, 'selection').map((value, axis) => value + delta[axis] * 2) as Vec3
  return componentAssetSchema.parse({ schemaVersion: 1, id: crypto.randomUUID(), name, objects: objects.map(object => moveObject(structuredClone(object), delta)), size: box.size, pivot2, orientation: 0 })
}
export function instantiateComponent(asset: ComponentAsset, position: Vec3): EditorObject {
  integerVector(position)
  const parsed = componentAssetSchema.parse(asset)
  const copy = (object: EditorObject): EditorObject => ({ ...object, id: crypto.randomUUID(), children: object.children.map(copy) })
  return {
    id: crypto.randomUUID(), name: parsed.name, kind: 'component', componentId: parsed.id, cells: [],
    children: parsed.objects.map(object => moveObject(copy(object), position)),
    pivot2: parsed.pivot2.map((value, axis) => value + position[axis] * 2) as Vec3, orientation: parsed.orientation,
  }
}
