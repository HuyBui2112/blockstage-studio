import type { Material } from '../core/catalog'
import type { SceneBlock, Vec3 } from '../core/schema'
import type { ObjectPatch } from './history'
import { validateDocument, type EditorDocument, type EditorObject } from './model'
import { assertCurrentPlan, checkPlanCancelled, operationBudget, validateOperationBase, type OperationBase, type OperationBudget } from './operation-plan'

export type DuplicateOptions = {
  base: OperationBase
  /** Allocate once per preview session outside this pure planner. Stable across offset changes. */
  operationId: string
  budget?: OperationBudget
  signal?: AbortSignal
}
export type DuplicatePlan = Readonly<{
  kind: 'duplicate'
  base: OperationBase
  source: EditorDocument
  document: EditorDocument
  delta: Vec3
  selection: string[]
  addedObjectIds: string[]
  patches: ObjectPatch[]
  cells: SceneBlock[]
  changedChunks: string[]
  cost: { addedObjects: number; addedCells: number; resultObjects: number; resultCells: number }
  signal?: AbortSignal
}>

/** Append-only K03 slice. Does not change block states, flatten owners or duplicate free entities. */
export function planDuplicate(document: EditorDocument, ids: string[], delta: Vec3, catalog: Material[], options: DuplicateOptions): DuplicatePlan {
  checkPlanCancelled(options.signal)
  validateOperationBase(document, options.base)
  if (delta.length !== 3 || delta.some(value => !Number.isSafeInteger(value))) throw new Error('Duplicate offset requires integer cell coordinates')
  if (!options.operationId || options.operationId.length > 180) throw new Error('Duplicate operation ID must contain 1–180 characters')
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Select distinct top-level objects to duplicate')
  const budget = operationBudget(options.budget), selectedIds = new Set(ids)
  const chosen = document.objects.filter(object => selectedIds.has(object.id))
  if (chosen.length !== ids.length) throw new Error('Selected object is missing; select the whole group or component')

  // Count before expanding copies. The bounded iterative walk also rejects cycles/shared nodes.
  const pending = document.objects.map(object => ({ object, depth: 1, selected: selectedIds.has(object.id) }))
  const seen = new Set<EditorObject>(), usedIds = new Set<string>()
  let objectCount = 0, cellCount = 0, addedObjects = 0, addedCells = 0
  for (let index = 0; index < pending.length; index++) {
    checkPlanCancelled(options.signal)
    const { object, depth, selected } = pending[index]
    if (seen.has(object) || depth > 16 || ++objectCount > budget.maxObjects) throw new Error('Object tree exceeds operation limits or contains a cycle')
    seen.add(object)
    if (usedIds.has(object.id)) throw new Error(`Duplicate object ID: ${object.id}`)
    usedIds.add(object.id)
    cellCount += object.cells.length
    if (selected) { addedObjects++; addedCells += object.cells.length }
    if (cellCount > budget.maxCells || cellCount + addedCells > budget.maxCells || objectCount + addedObjects > budget.maxObjects) throw new Error('Duplicate exceeds document cell/object budget')
    if (pending.length + object.children.length > budget.maxObjects) throw new Error('Object tree exceeds operation limits')
    for (const child of object.children) pending.push({ object: child, depth: depth + 1, selected })
  }
  if (objectCount + addedObjects > budget.maxObjects || cellCount + addedCells > budget.maxCells) throw new Error('Duplicate exceeds document cell/object budget')

  let ordinal = 0
  const addedObjectIds: string[] = [], cells: SceneBlock[] = [], chunks = new Set<string>()
  function copy(object: EditorObject, owner?: string): EditorObject {
    checkPlanCancelled(options.signal)
    const id = `${options.operationId}:${ordinal++}`
    if (usedIds.has(id)) throw new Error('Duplicate operation IDs conflict; start a new operation')
    usedIds.add(id); addedObjectIds.push(id)
    const top = owner ?? id
    const translated = object.cells.map(cell => {
      const pos = cell.pos.map((value, axis) => value + delta[axis]) as Vec3
      const state = { name: cell.state.name, properties: { ...cell.state.properties } }
      cells.push({ pos, state, owner: top })
      chunks.add(pos.map(value => Math.floor(value / 16)).join(','))
      return { pos, state }
    })
    return { ...object, id, cells: translated, children: object.children.map(child => copy(child, top)), pivot2: object.pivot2.map((value, axis) => value + 2 * delta[axis]) as Vec3 }
  }
  const copies = chosen.map(object => copy(object))
  const candidate = { ...document, objects: [...document.objects, ...copies] }
  // One shared final-footprint validator covers source/copy and copy/copy collisions,
  // coordinate/pivot limits, legal states and complete logical pairs.
  validateDocument(candidate, catalog)
  checkPlanCancelled(options.signal)
  return {
    kind: 'duplicate', base: { ...options.base }, source: document, document: candidate,
    delta: [...delta], selection: copies.map(object => object.id), addedObjectIds,
    patches: copies.map((object, index) => ({ id: object.id, after: { index: document.objects.length + index, object } })),
    cells, changedChunks: [...chunks], cost: { addedObjects, addedCells, resultObjects: objectCount + addedObjects, resultCells: cellCount + addedCells },
    ...(options.signal ? { signal: options.signal } : {}),
  }
}

/** Returns the exact validated preview, ready for one executeHistory call. No new IDs/replanning. */
export function applyDuplicatePlan(plan: DuplicatePlan, current: EditorDocument, base: OperationBase, catalog: Material[]): EditorDocument {
  checkPlanCancelled(plan.signal)
  assertCurrentPlan(plan.source, plan.base, current, base)
  validateDocument(plan.document, catalog)
  checkPlanCancelled(plan.signal)
  return plan.document
}
