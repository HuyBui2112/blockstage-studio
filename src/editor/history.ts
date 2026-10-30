import type { EditorDocument, EditorObject } from './model'

type ObjectEntry = { index: number; object: EditorObject }
export type ObjectPatch = { id: string; before?: ObjectEntry; after?: ObjectEntry }
type DocumentMetadata = Omit<EditorDocument, 'objects'>
export type HistoryCommand = { label: string; patches: ObjectPatch[]; beforeMetadata?: DocumentMetadata; afterMetadata?: DocumentMetadata }
export type EditorHistory = { document: EditorDocument; past: HistoryCommand[]; future: HistoryCommand[] }

function cellCount(object: EditorObject): number {
  return object.cells.length + object.children.reduce((sum, child) => sum + cellCount(child), 0)
}
function boundedPast(commands: HistoryCommand[]): HistoryCommand[] {
  let retainedCells = 0
  let first = commands.length - 1
  for (let index = commands.length - 1; index >= 0; index--) {
    const cells = commands[index].patches.reduce((sum, patch) => sum + (patch.before ? cellCount(patch.before.object) : 0) + (patch.after ? cellCount(patch.after.object) : 0), 0)
    if (index !== commands.length - 1 && (commands.length - index > 64 || retainedCells + cells > 500000)) break
    retainedCells += cells; first = index
  }
  return commands.slice(first)
}

export function createHistory(document: EditorDocument): EditorHistory { return { document: structuredClone(document), past: [], future: [] } }
const equal = (left: unknown, right: unknown) => left === right || JSON.stringify(left) === JSON.stringify(right)
function metadata(document: EditorDocument): DocumentMetadata {
  const { objects: _objects, ...rest } = document
  return rest
}
export function executeHistory(history: EditorHistory, next: EditorDocument, label: string): EditorHistory {
  const previous = history.document
  const before = new Map(previous.objects.map((object, index) => [object.id, { object, index }]))
  const after = new Map(next.objects.map((object, index) => [object.id, { object, index }]))
  const commonBefore = previous.objects.filter(object => after.has(object.id)).map(object => object.id)
  const commonAfter = next.objects.filter(object => before.has(object.id)).map(object => object.id)
  const reordered = !equal(commonBefore, commonAfter)
  const patches: ObjectPatch[] = []
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const oldEntry = before.get(id), newEntry = after.get(id)
    if (!oldEntry || !newEntry || (reordered && oldEntry.index !== newEntry.index) || !equal(oldEntry.object, newEntry.object)) patches.push(structuredClone({ id, before: oldEntry, after: newEntry }))
  }
  const oldMetadata = metadata(previous), newMetadata = metadata(next)
  const changedMetadata = !equal(oldMetadata, newMetadata)
  if (!patches.length && !changedMetadata) return history
  const command: HistoryCommand = { label, patches, ...(changedMetadata ? { beforeMetadata: structuredClone(oldMetadata), afterMetadata: structuredClone(newMetadata) } : {}) }
  return { document: next, past: boundedPast([...history.past, command]), future: [] }
}
function apply(document: EditorDocument, command: HistoryCommand, direction: 'before' | 'after'): EditorDocument {
  const touched = new Set(command.patches.map(patch => patch.id))
  const objects = document.objects.filter(object => !touched.has(object.id))
  const entries = command.patches.flatMap(patch => patch[direction] ? [patch[direction]!] : []).sort((a, b) => a.index - b.index)
  for (const entry of entries) objects.splice(entry.index, 0, structuredClone(entry.object))
  const documentMetadata = direction === 'before' ? command.beforeMetadata : command.afterMetadata
  return { ...(documentMetadata ? structuredClone(documentMetadata) : document), objects }
}
export function undoHistory(history: EditorHistory): EditorHistory {
  const command = history.past[history.past.length - 1]
  if (!command) return history
  return { document: apply(history.document, command, 'before'), past: history.past.slice(0, -1), future: [...history.future, command] }
}
export function redoHistory(history: EditorHistory): EditorHistory {
  const command = history.future[history.future.length - 1]
  if (!command) return history
  return { document: apply(history.document, command, 'after'), past: [...history.past, command], future: history.future.slice(0, -1) }
}
