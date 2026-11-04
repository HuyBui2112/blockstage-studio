import { z } from 'zod'
import { blockSchema, entitySchema, projectSchema, type Block, type Project, type SceneBlock, type SceneEntity, type Vec3 } from '../core/schema'
import { instantiate } from '../core/assembly'
import { createStateValidator, type Material } from '../core/catalog'
import { logicalCellGroups, validateLogicalFootprints } from './placement'
import { measurePhase } from '../core/measurement-phases'

export type QuarterTurn = 0 | 1 | 2 | 3
export type PivotMode = 'active' | 'selection' | 'individual'
export type CoordinateSpace = 'global' | 'local'
export type EditorObject = {
  id: string; name: string; kind: 'block' | 'multiblock' | 'group' | 'component'
  cells: Block[]; children: EditorObject[]; pivot2: Vec3; orientation: QuarterTurn; componentId?: string
}
export type EditorDocument = {
  schemaVersion: 2; id: string; name: string; workspace: 'architecture' | 'component'
  target: { gameVersion: '26.2'; dataVersion: 4903 }; objects: EditorObject[]; entities: SceneEntity[]
}
export type ComponentAsset = {
  schemaVersion: 1; id: string; name: string; objects: EditorObject[]; pivot2: Vec3; size: Vec3; orientation: QuarterTurn
}

const pivotSchema = z.tuple([z.number().int().min(-60000000).max(60000002), z.number().int().min(-4096).max(4098), z.number().int().min(-60000000).max(60000002)])
const quarterSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
const labelSchema = z.string().trim().min(1).max(120)
function objectSchema(depth: number): z.ZodType<EditorObject> {
  return z.object({
    id: z.string().min(1).max(200), name: labelSchema,
    kind: z.enum(['block', 'multiblock', 'group', 'component']),
    cells: z.array(blockSchema).max(100000), children: depth < 16 ? z.array(objectSchema(depth + 1)).max(100000) : z.array(z.never()).max(0),
    pivot2: pivotSchema, orientation: quarterSchema, componentId: z.string().min(1).max(200).optional(),
  }).strict()
}
function boundedObjects(value: unknown, context: z.RefinementCtx): unknown {
  if (!Array.isArray(value)) return value
  if (value.length > 100000) { context.addIssue({ code: 'custom', message: 'Document exceeds 100,000 objects' }); return z.NEVER }
  const pending = value.map(object => ({ object, depth: 1 }))
  const seen = new Set<object>()
  let count = 0, cells = 0
  for (let index = 0; index < pending.length; index++) {
    const { object, depth } = pending[index]
    if (!object || typeof object !== 'object') continue
    if (seen.has(object) || ++count > 100000 || depth > 16) {
      context.addIssue({ code: 'custom', message: 'Object tree exceeds its limits or contains a cycle' }); return z.NEVER
    }
    seen.add(object)
    const entry = object as { cells?: unknown; children?: unknown }
    if (Array.isArray(entry.cells)) cells += entry.cells.length
    if (cells > 100000) { context.addIssue({ code: 'custom', message: 'Document exceeds 100,000 cells' }); return z.NEVER }
    if (Array.isArray(entry.children)) {
      if (pending.length + entry.children.length > 100000) { context.addIssue({ code: 'custom', message: 'Document exceeds 100,000 objects' }); return z.NEVER }
      for (const child of entry.children) pending.push({ object: child, depth: depth + 1 })
    }
  }
  return value
}
const objectsSchema = z.preprocess(boundedObjects, z.array(objectSchema(1)).max(100000))
function structureError(objects: EditorObject[]): string | undefined {
  const ids = new Set<string>(), occupied = new Set<string>()
  let count = 0, objectCount = 0
  const visit = (object: EditorObject): string | undefined => {
    if (++objectCount > 100000) return 'Document exceeds 100,000 objects'
    if (ids.has(object.id)) return `Duplicate object ID: ${object.id}`
    ids.add(object.id)
    if (object.kind === 'block' && (object.cells.length !== 1 || object.children.length)) return 'A block object must contain one cell'
    if (object.kind === 'multiblock' && (object.cells.length < 2 || object.children.length)) return 'A multi-block object must contain its complete cells'
    if (object.kind === 'group' && (object.cells.length || !object.children.length)) return 'A group must contain child objects'
    if (object.kind === 'component' && ((!object.cells.length && !object.children.length) || (object.cells.length && object.children.length))) return 'A component must contain cells or child objects'
    for (const cell of object.cells) {
      if (++count > 100000) return 'Document exceeds 100,000 cells'
      const key = cell.pos.join(',')
      if (occupied.has(key)) return `Cell collision at ${key}`
      occupied.add(key)
    }
    for (const child of object.children) { const error = visit(child); if (error) return error }
  }
  for (const object of objects) { const error = visit(object); if (error) return error }
}
export const editorDocumentSchema: z.ZodType<EditorDocument> = z.object({
  schemaVersion: z.literal(2), id: z.string().min(1).max(200), name: labelSchema,
  workspace: z.enum(['architecture', 'component']),
  target: z.object({ gameVersion: z.literal('26.2'), dataVersion: z.literal(4903) }).strict(),
  objects: objectsSchema, entities: z.array(entitySchema).max(1000),
}).strict().superRefine((document, context) => {
  const error = structureError(document.objects)
  if (error) context.addIssue({ code: 'custom', message: error })
  if (new Set(document.entities.map(entity => entity.id)).size !== document.entities.length) context.addIssue({ code: 'custom', message: 'Duplicate entity ID' })
})
export const componentAssetSchema: z.ZodType<ComponentAsset> = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1).max(200), name: labelSchema, objects: objectsSchema.refine(objects => objects.length > 0, 'A component must contain objects'),
  pivot2: pivotSchema, size: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]), orientation: quarterSchema,
}).strict().superRefine((asset, context) => {
  const error = structureError(asset.objects)
  if (error) context.addIssue({ code: 'custom', message: error })
})

export function newEditorDocument(workspace: EditorDocument['workspace'] = 'architecture'): EditorDocument {
  return { schemaVersion: 2, id: crypto.randomUUID(), name: workspace === 'architecture' ? 'Untitled architecture' : 'Untitled component', workspace, target: { gameVersion: '26.2', dataVersion: 4903 }, objects: [], entities: [] }
}
export function objectCells(object: EditorObject): Block[] {
  return [...object.cells, ...object.children.flatMap(objectCells)]
}
export function sceneBlocks(document: EditorDocument): SceneBlock[] {
  return measurePhase('scene.flatten',()=>document.objects.flatMap(object => objectCells(object).map(cell => ({ ...cell, owner: object.id }))))
}
export function validateDocument(document: EditorDocument, catalog: Material[]): void {
  return measurePhase('validation.total',()=>validateDocumentInner(document,catalog))
}
function validateDocumentInner(document:EditorDocument,catalog:Material[]):void{
  const parsed = measurePhase('validation.schema',()=>editorDocumentSchema.safeParse(document))
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid editor document')
  measurePhase('validation.states-and-pairs',()=>{
  const validateState=createStateValidator(catalog)
  for (const object of document.objects) {
    for (const cell of objectCells(object)) validateState(cell.state)
    // The full document schema and this root's registry pass already checked
    // cells. Keep pair semantics without parsing/validating each cell twice.
    validateLogicalFootprints(object)
  }
  })
}

/** Explicit conversion only. Legacy storage and the supplied project are never modified. */
export function fromLegacyProject(project: Project): EditorDocument {
  const legacy = projectSchema.parse(project)
  const used = new Set(legacy.instances.map(instance => instance.id))
  const blockIndices = new Map(legacy.blocks.map((block, index) => [block.pos.join(','), index]))
  const objects: EditorObject[] = logicalCellGroups(legacy.blocks).map(cells => {
    const cell = cells[0]
    const index = blockIndices.get(cell.pos.join(','))!
    let id = `legacy-block-${index}`
    while (used.has(id)) id += '-block'
    used.add(id)
    return { id, name: cell.state.name.split(':')[1], kind: cells.length > 1 ? 'multiblock' : 'block', cells: structuredClone(cells), children: [], pivot2: cell.pos.map(value => value * 2 + 1) as Vec3, orientation: 0 }
  })
  for (const instance of legacy.instances) {
    const component = legacy.components.find(value => value.id === instance.componentId)
    if (!component) throw new Error('Legacy component is missing')
    const cells = instantiate(component, instance).map(({ pos, state }) => structuredClone({ pos, state }))
    logicalCellGroups(cells)
    objects.push({ id: instance.id, name: component.name, kind: 'component', componentId: component.id, cells, children: [], pivot2: instance.position.map(value => value * 2 + 1) as Vec3, orientation: instance.rotation })
  }
  return editorDocumentSchema.parse({ schemaVersion: 2, id: legacy.id, name: legacy.name, workspace: 'architecture', target: legacy.target, objects, entities: structuredClone(legacy.entities) })
}
