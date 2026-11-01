import type { Material } from '../core/catalog'
import type { SceneBlock, Vec3 } from '../core/schema'
import type { ObjectPatch } from './history'
import { validateDocument, type EditorDocument, type EditorObject } from './model'
import { assertCurrentPlan, checkPlanCancelled, operationBudget, validateOperationBase, type OperationBase, type OperationBudget } from './operation-plan'

export type CopyPlanOptions = { base: OperationBase; operationId: string; budget?: OperationBudget; signal?: AbortSignal }
export type CopyPattern = { count: number; offset: Vec3; step: Vec3 }
export type ObjectCopyPlan = Readonly<{
  base: OperationBase; source: EditorDocument; document: EditorDocument
  selection: string[]; addedObjectIds: string[]; patches: ObjectPatch[]
  cells: SceneBlock[]; changedChunks: string[]
  cost: { addedObjects: number; addedCells: number; resultObjects: number; resultCells: number }
  signal?: AbortSignal
}>

export function selectedCopyObjects(document: EditorDocument, ids: string[]): EditorObject[] {
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Select distinct top-level objects to duplicate')
  const chosen = new Set(ids), objects = document.objects.filter(object => chosen.has(object.id))
  if (objects.length !== ids.length) throw new Error('Selected object is missing; select the whole group or component')
  return objects
}
function integerOffset(vector: Vec3) {
  if (vector.length !== 3 || vector.some(value => !Number.isSafeInteger(value))) throw new Error('Copy offset requires integer cell coordinates')
}
function measure(objects: EditorObject[], options: CopyPlanOptions, maxObjects: number, maxCells: number) {
  const pending = objects.map(object => ({ object, depth: 1 })), seen = new Set<EditorObject>(), ids = new Set<string>()
  let cells = 0
  if (pending.length > maxObjects) throw new Error('Object tree exceeds operation limits')
  for (let index = 0; index < pending.length; index++) {
    checkPlanCancelled(options.signal)
    const { object, depth } = pending[index]
    if (seen.has(object) || depth > 16) throw new Error('Object tree exceeds operation limits or contains a cycle')
    seen.add(object)
    if (ids.has(object.id)) throw new Error(`Duplicate object ID: ${object.id}`)
    ids.add(object.id)
    cells += object.cells.length
    if (cells > maxCells || pending.length + object.children.length > maxObjects) throw new Error('Copy exceeds document cell/object budget or tree limits')
    for (const child of object.children) pending.push({ object: child, depth: depth + 1 })
  }
  return { objects: pending.length, cells, ids }
}

/** Shared append-only copy primitive. Sources must be validated committed objects or a clipboard snapshot. */
export function planObjectCopies(document: EditorDocument, objects: EditorObject[], pattern: CopyPattern, catalog: Material[], options: CopyPlanOptions): ObjectCopyPlan {
  checkPlanCancelled(options.signal); validateOperationBase(document, options.base)
  integerOffset(pattern.offset); integerOffset(pattern.step)
  if (!Number.isSafeInteger(pattern.count) || pattern.count < 1 || pattern.count > 100000) throw new Error('Copy count must be an integer between 1 and 100,000')
  if (!objects.length) throw new Error('Copy source must contain objects')
  if (!options.operationId || options.operationId.length > 180) throw new Error('Duplicate operation ID must contain 1–180 characters')
  integerOffset(pattern.offset.map((value, axis) => value + pattern.step[axis] * (pattern.count - 1)) as Vec3)
  const budget = operationBudget(options.budget)
  const destination = measure(document.objects, options, budget.maxObjects, budget.maxCells)
  const source = measure(objects, options, budget.maxObjects, budget.maxCells)
  const addedObjects = source.objects * pattern.count, addedCells = source.cells * pattern.count
  if (destination.objects + addedObjects > budget.maxObjects || destination.cells + addedCells > budget.maxCells) throw new Error('Duplicate exceeds document cell/object budget')

  let ordinal = 0
  const addedObjectIds: string[] = [], cells: SceneBlock[] = [], chunks = new Set<string>(), usedIds = new Set([...destination.ids, ...source.ids])
  function copy(object: EditorObject, delta: Vec3, owner?: string): EditorObject {
    checkPlanCancelled(options.signal)
    const id = `${options.operationId}:${ordinal++}`
    if (usedIds.has(id)) throw new Error('Duplicate operation IDs conflict; start a new operation')
    usedIds.add(id); addedObjectIds.push(id)
    const top = owner ?? id
    const translated = object.cells.map(cell => {
      const pos = cell.pos.map((value, axis) => value + delta[axis]) as Vec3
      const state = { name: cell.state.name, properties: { ...cell.state.properties } }
      cells.push({ pos, state, owner: top }); chunks.add(pos.map(value => Math.floor(value / 16)).join(','))
      return { pos, state }
    })
    return { ...object, id, cells: translated, children: object.children.map(child => copy(child, delta, top)), pivot2: object.pivot2.map((value, axis) => value + 2 * delta[axis]) as Vec3 }
  }
  const copies: EditorObject[] = []
  for (let index = 0; index < pattern.count; index++) {
    const delta = pattern.offset.map((value, axis) => value + pattern.step[axis] * index) as Vec3
    for (const object of objects) copies.push(copy(object, delta))
  }
  const candidate = { ...document, objects: [...document.objects, ...copies] }
  validateDocument(candidate, catalog); checkPlanCancelled(options.signal)
  return {
    base: { ...options.base }, source: document, document: candidate,
    selection: copies.map(object => object.id), addedObjectIds,
    patches: copies.map((object, index) => ({ id: object.id, after: { index: document.objects.length + index, object } })),
    cells, changedChunks: [...chunks], cost: { addedObjects, addedCells, resultObjects: destination.objects + addedObjects, resultCells: destination.cells + addedCells },
    ...(options.signal ? { signal: options.signal } : {}),
  }
}
export function applyObjectCopyPlan(plan: ObjectCopyPlan, current: EditorDocument, base: OperationBase, catalog: Material[]): EditorDocument {
  checkPlanCancelled(plan.signal); assertCurrentPlan(plan.source, plan.base, current, base)
  validateDocument(plan.document, catalog); checkPlanCancelled(plan.signal)
  return plan.document
}
