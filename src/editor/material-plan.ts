import { createReplacementResolver, type ReplacementCapability } from '../core/capabilities'
import type { Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import { key, type Vec3 } from '../core/schema'
import { finalizeCopyPlan } from './copy-action'
import { applyObjectCopyPlan, type CopyPlanOptions, type ObjectCopyPlan } from './copy-plan'
import { executeHistory } from './history'
import { sceneBlocks, validateDocument, type EditorDocument, type EditorObject } from './model'
import { checkPlanCancelled, operationBudget, validateOperationBase, type OperationBase } from './operation-plan'

export type MaterialReplacementIntent = { sourceId: string; targetId: string }
export type MaterialReplacementMatch = Readonly<{ objectId: string; ownerId: string; position: Vec3; compatibility: ReplacementCapability }>
export type MaterialReplacementReport = Readonly<{ matchedCells: number; matchedObjects: number; selectedRoots: number; matches: readonly MaterialReplacementMatch[] }>
export type MaterialReplacementPlan = ObjectCopyPlan & MaterialReplacementReport & Readonly<{ intent: MaterialReplacementIntent; notes: string[]; rules?: NeighborRules }>
export class MaterialReplacementError extends Error {
  readonly report: MaterialReplacementReport
  constructor(report: MaterialReplacementReport) {
    const unsupported = report.matches.filter(match => !match.compatibility.supported)
    super(`Material replacement rejected: ${unsupported.length} of ${report.matchedCells} matching cells are incompatible. ${unsupported[0]?.compatibility.reason ?? ''}`)
    this.report = report
  }
}

/** Whole selected roots only. No state defaults, geometry rewrites or implicit partial success. */
export function planMaterialReplacement(document: EditorDocument, ids: string[], intent: MaterialReplacementIntent, catalog: Material[], options: CopyPlanOptions, rules?: NeighborRules): MaterialReplacementPlan {
  checkPlanCancelled(options.signal); validateOperationBase(document, options.base)
  if (!ids.length) throw new Error('Select top-level objects to replace material')
  if (new Set(ids).size !== ids.length) throw new Error('Select distinct top-level objects')
  const selected = new Set(ids)
  if (document.objects.filter(object => selected.has(object.id)).length !== ids.length) throw new Error('Selected object is missing; select the whole group or component')
  if (intent.sourceId === intent.targetId) throw new Error('Source and target material are identical; no change')
  if (!options.operationId || options.operationId.length > 180) throw new Error('Replacement operation ID must contain 1–180 characters')
  const budget = operationBudget(options.budget)
  // Bound aggregate work before recursive validation or candidate allocation.
  const pending = document.objects.map(object => ({ object, depth: 1 })), seen = new Set<EditorObject>()
  let resultCells = 0
  if (pending.length > budget.maxObjects) throw new Error('Replacement exceeds document object budget')
  for (let index = 0; index < pending.length; index++) {
    checkPlanCancelled(options.signal)
    const { object, depth } = pending[index]
    if (seen.has(object) || depth > 16) throw new Error('Object tree exceeds operation limits or contains a cycle')
    seen.add(object); resultCells += object.cells.length
    if (resultCells > budget.maxCells || pending.length + object.children.length > budget.maxObjects) throw new Error('Replacement exceeds document cell/object budget')
    for (const child of object.children) pending.push({ object: child, depth: depth + 1 })
  }
  validateDocument(document, catalog)
  const matches: MaterialReplacementMatch[] = [], matchedIds = new Set<string>(), cache = new Map<string, ReplacementCapability>()
  const replacementCompatibility=createReplacementResolver(catalog)
  function inspect(object: EditorObject, ownerId: string) {
    checkPlanCancelled(options.signal)
    for (const cell of object.cells) if (cell.state.name === intent.sourceId) {
      const stateKey = JSON.stringify(Object.entries(cell.state.properties).sort(([a], [b]) => a.localeCompare(b)))
      let compatibility = cache.get(stateKey)
      if (!compatibility) { compatibility = replacementCompatibility(cell.state, intent.targetId); cache.set(stateKey, compatibility) }
      matches.push({ objectId: object.id, ownerId, position: [...cell.pos], compatibility }); matchedIds.add(object.id)
    }
    for (const child of object.children) inspect(child, ownerId)
  }
  for (const object of document.objects) if (selected.has(object.id)) inspect(object, object.id)
  const report = { matchedCells: matches.length, matchedObjects: matchedIds.size, selectedRoots: ids.length, matches }
  if (!matches.length) throw new Error('No selected cells match the source material')
  if (matches.some(match => !match.compatibility.supported)) throw new MaterialReplacementError(report)
  function replace(object: EditorObject): EditorObject {
    checkPlanCancelled(options.signal)
    const cells = object.cells.map(cell => cell.state.name === intent.sourceId ? { ...cell, state: { name: intent.targetId, properties: { ...cell.state.properties } } } : cell)
    const children = object.children.map(replace)
    return cells.some((cell, index) => cell !== object.cells[index]) || children.some((child, index) => child !== object.children[index]) ? { ...object, cells, children } : object
  }
  const candidate = { ...document, objects: document.objects.map(object => selected.has(object.id) ? replace(object) : object) }
  validateDocument(candidate, catalog); checkPlanCancelled(options.signal)
  const changedPositions = new Set(matches.map(match => key(match.position)))
  const cells = sceneBlocks(candidate).filter(cell => changedPositions.has(key(cell.pos)))
  const history = executeHistory({ document, past: [], future: [] }, candidate, 'Replace material')
  const plan: ObjectCopyPlan = {
    base: { ...options.base }, source: document, document: candidate, selection: [...ids], addedObjectIds: [],
    patches: history.past[0].patches, cells,
    changedChunks: [...new Set(cells.map(cell => cell.pos.map(value => Math.floor(value / 16)).join(',')))],
    cost: { addedObjects: 0, addedCells: 0, resultObjects: pending.length, resultCells },
    ...(options.signal ? { signal: options.signal } : {}),
  }
  return { ...finalizeCopyPlan(plan, catalog, rules), ...report, intent: { ...intent } }
}

/** Commit exactly the candidate that was previewed; policy and source identity must still match. */
export function applyMaterialReplacement(plan: MaterialReplacementPlan, current: EditorDocument, base: OperationBase, catalog: Material[], rules?: NeighborRules): EditorDocument {
  if (plan.rules !== rules) throw new Error('Auto connections changed. Rebuild the operation preview.')
  return applyObjectCopyPlan(plan, current, base, catalog)
}
