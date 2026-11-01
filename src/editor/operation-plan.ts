import type { EditorDocument } from './model'

/** Local committed revision, never a Saved/CAS token. Epoch changes on document switches. */
export type OperationBase = Readonly<{ documentId: string; sessionEpoch: string; revision: number }>
export type OperationBudget = Readonly<{ maxCells: number; maxObjects: number }>
export const DEFAULT_OPERATION_BUDGET: OperationBudget = Object.freeze({ maxCells: 100000, maxObjects: 100000 })

export function checkPlanCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Operation cancelled')
}
export function validateOperationBase(document: EditorDocument, base: OperationBase): void {
  if (base.documentId !== document.id || !base.sessionEpoch || !Number.isSafeInteger(base.revision) || base.revision < 0) throw new Error('Invalid operation base')
}
export function assertCurrentPlan(source: EditorDocument, base: OperationBase, current: EditorDocument, currentBase: OperationBase): void {
  validateOperationBase(current, currentBase)
  if (source !== current || base.documentId !== currentBase.documentId || base.sessionEpoch !== currentBase.sessionEpoch || base.revision !== currentBase.revision) throw new Error('The document changed. Rebuild the operation preview.')
}
export function operationBudget(value: OperationBudget = DEFAULT_OPERATION_BUDGET): OperationBudget {
  if (![value.maxCells, value.maxObjects].every(limit => Number.isSafeInteger(limit) && limit >= 0 && limit <= 100000)) throw new Error('Operation limits must be integers between 0 and 100,000')
  return value
}
