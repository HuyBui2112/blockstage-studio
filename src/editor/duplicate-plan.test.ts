import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { Vec3 } from '../core/schema'
import { applyDuplicatePlan, planDuplicate } from './duplicate-plan'
import { createHistory, executeHistory, redoHistory, undoHistory } from './history'
import { newEditorDocument, objectCells, type EditorDocument, type EditorObject } from './model'
import { createPlacedObject } from './placement'

const material = (id: string, properties: Record<string, string[]>, defaults: Record<string, string>): Material => ({ id: `minecraft:${id}`, label: id, family: id, color: '#aaa', properties, defaults })
const facing = ['north', 'east', 'south', 'west']
const catalog = [...DEMO_MATERIALS,
  material('air', {}, {}),
  material('red_bed', { facing, part: ['foot', 'head'], occupied: ['false', 'true'] }, { facing: 'east', part: 'foot', occupied: 'false' }),
  material('oak_door', { facing, half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'], powered: ['false', 'true'] }, { facing: 'south', half: 'lower', hinge: 'right', open: 'true', powered: 'false' }),
]
function block(id: string, pos: Vec3 = [0, 0, 0], name = 'stone', properties: Record<string, string> = {}): EditorObject {
  return { ...createPlacedObject({ ...defaultState(`minecraft:${name}`, catalog), properties: { ...defaultState(`minecraft:${name}`, catalog).properties, ...properties } }, pos, catalog), id }
}
function document(...objects: EditorObject[]): EditorDocument { return { ...newEditorDocument(), id: 'document', objects } }
const base = { documentId: 'document', sessionEpoch: 'session', revision: 7 }
const options = { base, operationId: 'duplicate' }
function group(id: string, children: EditorObject[]): EditorObject { return { id, name: id, kind: 'group', cells: [], children, pivot2: [-1, 1, 3], orientation: 2 } }

describe('duplicate operation plans', () => {
  it('preserves golden logical states, negative cells, pivots, provenance, air and entities without mutating the source', () => {
    const component = { ...group('component', [block('bed', [-18, -3, -4], 'red_bed'), block('door', [-14, -3, -4], 'oak_door')]), kind: 'component' as const, componentId: 'library-source' }
    const source = document(group('root', [component, block('log', [-11, -3, -4], 'oak_log', { axis: 'z' }), block('slab', [-9, -3, -4], 'stone_brick_slab', { type: 'top' }), block('stairs', [-7, -3, -4], 'oak_stairs', { shape: 'inner_right', half: 'top', facing: 'west' }), block('air', [-5, -3, -4], 'air')]))
    source.entities = [{ id: 'entity', type: 'minecraft:pig', position: [1, 2, 3], yaw: 90 }]
    const snapshot = structuredClone(source)
    const plan = planDuplicate(source, ['root'], [0, 8, -16], catalog, options)
    const copy = plan.document.objects[1]
    expect(source).toEqual(snapshot)
    expect(plan.document.objects[0]).toBe(source.objects[0])
    expect(plan.document.entities).toBe(source.entities)
    expect(copy).toMatchObject({ id: 'duplicate:0', kind: 'group', orientation: 2, pivot2: [-1, 17, -29] })
    expect(copy.children[0]).toMatchObject({ kind: 'component', componentId: 'library-source', orientation: 2 })
    expect(objectCells(copy)).toEqual(objectCells(source.objects[0]).map(cell => ({ pos: [cell.pos[0], cell.pos[1] + 8, cell.pos[2] - 16], state: cell.state })))
    expect(copy.pivot2).not.toBe(source.objects[0].pivot2)
    expect(objectCells(copy)[0].pos).not.toBe(objectCells(source.objects[0])[0].pos)
    expect(objectCells(copy)[0].state).not.toBe(objectCells(source.objects[0])[0].state)
    expect(objectCells(copy)[0].state.properties).not.toBe(objectCells(source.objects[0])[0].state.properties)
    expect(plan.selection).toEqual(['duplicate:0'])
    expect(plan.addedObjectIds).toEqual(Array.from({ length: 8 }, (_, index) => `duplicate:${index}`))
    expect(plan.cells.every(cell => cell.owner === 'duplicate:0')).toBe(true)
    expect(plan.cost).toEqual({ addedObjects: 8, addedCells: 8, resultObjects: 16, resultCells: 16 })
    expect(applyDuplicatePlan(plan, source, base, catalog)).toBe(plan.document)
  })

  it('allocates stable IDs in document order across selection order and preview offsets', () => {
    const source = document(block('a'), block('b', [4, 0, 0]))
    const first = planDuplicate(source, ['b', 'a'], [0, 1, 0], catalog, options)
    const second = planDuplicate(source, ['a', 'b'], [0, 2, 0], catalog, options)
    expect(first.selection).toEqual(second.selection)
    expect(first.addedObjectIds).toEqual(second.addedObjectIds)
    expect(first.document.objects.slice(2).map(object => object.cells[0].pos)).toEqual([[0, 1, 0], [4, 1, 0]])
  })

  it('uses fresh operation IDs for a subsequent duplication and rejects reuse', () => {
    const source = document(block('a'))
    const first = planDuplicate(source, ['a'], [2, 0, 0], catalog, options)
    const nextOptions = { base: { ...base, revision: 8 }, operationId: 'next' }
    expect(planDuplicate(first.document, first.selection, [2, 0, 0], catalog, nextOptions).selection).toEqual(['next:0'])
    expect(() => planDuplicate(first.document, ['a'], [4, 0, 0], catalog, { ...nextOptions, operationId: 'duplicate' })).toThrow(/conflict/)
  })

  it('reports only destination chunks using floor division at negative boundaries', () => {
    const source = document(block('a', [-1, -1, -1]), block('b', [-17, -17, -17]))
    const plan = planDuplicate(source, ['b', 'a'], [0, 0, -16], catalog, options)
    expect(plan.changedChunks).toEqual(['-1,-1,-2', '-2,-2,-3'])
    expect(plan.patches).toEqual(plan.document.objects.slice(2).map((object, index) => ({ id: object.id, after: { index: index + 2, object } })))
  })

  it('keeps originals occupied and rejects zero offset or overlap with unselected objects', () => {
    const source = document(block('a'), block('b', [2, 0, 0]))
    for (const delta of [[0, 0, 0], [2, 0, 0]] as Vec3[]) expect(() => planDuplicate(source, ['a'], delta, catalog, options)).toThrow(/collision/i)
    expect(source.objects).toHaveLength(2)
  })

  it('rejects empty, repeated, missing and nested selections', () => {
    const source = document(group('root', [block('child')]))
    for (const ids of [[], ['root', 'root'], ['missing'], ['child'], ['root', 'child']]) expect(() => planDuplicate(source, ids, [2, 0, 0], catalog, options)).toThrow(/select|missing/i)
  })

  it('rejects noninteger offsets, invalid operation IDs and invalid bases', () => {
    const source = document(block('a'))
    for (const delta of [[0.5, 0, 0], [Infinity, 0, 0], [Number.MAX_SAFE_INTEGER + 1, 0, 0]] as Vec3[]) expect(() => planDuplicate(source, ['a'], delta, catalog, options)).toThrow(/integer/)
    for (const operationId of ['', 'x'.repeat(181)]) expect(() => planDuplicate(source, ['a'], [2, 0, 0], catalog, { ...options, operationId })).toThrow(/ID/)
    for (const invalid of [{ ...base, documentId: 'other' }, { ...base, revision: -1 }, { ...base, sessionEpoch: '' }]) expect(() => planDuplicate(source, ['a'], [2, 0, 0], catalog, { ...options, base: invalid })).toThrow(/base/)
  })

  it('rejects translated cells and pivots outside schema limits', () => {
    const edge = document(block('a', [30000000, 0, 0]))
    expect(() => planDuplicate(edge, ['a'], [1, 0, 0], catalog, options)).toThrow()
    const pivot = document({ ...block('a'), pivot2: [60000002, 1, 1] })
    expect(() => planDuplicate(pivot, ['a'], [1, 0, 0], catalog, options)).toThrow()
  })

  it('rejects invalid final logical pairs and illegal explicit states', () => {
    const pair = block('bed', [0, 0, 0], 'red_bed')
    pair.cells.pop()
    expect(() => planDuplicate(document(pair), ['bed'], [4, 0, 0], catalog, options)).toThrow()
    const invalid = block('log', [0, 0, 0], 'oak_log')
    invalid.cells[0].state.properties.axis = 'invalid'
    expect(() => planDuplicate(document(invalid), ['log'], [4, 0, 0], catalog, options)).toThrow()
  })

  it('honors cancellation before planning and after preview', () => {
    const source = document(block('a')), controller = new AbortController()
    const plan = planDuplicate(source, ['a'], [2, 0, 0], catalog, { ...options, signal: controller.signal })
    controller.abort()
    expect(() => applyDuplicatePlan(plan, source, base, catalog)).toThrow(/cancelled/)
    expect(() => planDuplicate(source, ['a'], [2, 0, 0], catalog, { ...options, signal: controller.signal })).toThrow(/cancelled/)
  })

  it('rejects stale identity, epoch, revision and same-content Undo/Redo revisions', () => {
    const source = document(block('a')), plan = planDuplicate(source, ['a'], [2, 0, 0], catalog, options)
    expect(() => applyDuplicatePlan(plan, structuredClone(source), base, catalog)).toThrow(/changed/)
    for (const currentBase of [{ ...base, sessionEpoch: 'new' }, { ...base, revision: 9 }]) expect(() => applyDuplicatePlan(plan, source, currentBase, catalog)).toThrow(/changed/)
    expect(() => applyDuplicatePlan(plan, { ...source, id: 'other' }, { ...base, documentId: 'other' }, catalog)).toThrow(/changed/)
    const undone = undoHistory(executeHistory({ document: source, past: [], future: [] }, plan.document, 'Duplicate'))
    expect(undone.document).toEqual(source)
    expect(() => applyDuplicatePlan(plan, undone.document, { ...base, revision: 9 }, catalog)).toThrow(/changed/)
  })

  it('counts nested selected and unselected objects and cells against aggregate budgets', () => {
    const source = document(group('root', [block('child')]), block('other', [8, 0, 0]))
    const plan = planDuplicate(source, ['root'], [2, 0, 0], catalog, { ...options, budget: { maxObjects: 5, maxCells: 3 } })
    expect(plan.cost).toEqual({ addedObjects: 2, addedCells: 1, resultObjects: 5, resultCells: 3 })
    for (const budget of [{ maxObjects: 4, maxCells: 3 }, { maxObjects: 5, maxCells: 2 }, { maxObjects: 100001, maxCells: 3 }, { maxObjects: 5, maxCells: -1 }]) expect(() => planDuplicate(source, ['root'], [2, 0, 0], catalog, { ...options, budget })).toThrow(/budget|limits/)
  })

  it('blocks aggregate overflow before expanding copy cells', () => {
    const leaf = block('a')
    const cell = leaf.cells[0]
    leaf.cells = Array.from({ length: 50001 }, () => cell)
    Object.defineProperty(cell, 'state', { get() { throw new Error('copy expansion must not run') } })
    expect(() => planDuplicate(document(group('root', [leaf])), ['root'], [2, 0, 0], catalog, options)).toThrow(/budget/)
  })

  it('rejects cycles, shared nodes, depth overflow and nested duplicate IDs before copy expansion', () => {
    const child = block('child')
    const cycle = group('cycle', [child]); cycle.children.push(cycle)
    let deep = block('leaf')
    for (let index = 0; index < 16; index++) deep = group(`depth-${index}`, [deep])
    for (const root of [cycle, group('shared', [child, child]), deep, group('duplicate-ids', [block('same'), block('same', [2, 0, 0])])]) expect(() => planDuplicate(document(root), [root.id], [4, 0, 0], catalog, options)).toThrow(/limits|cycle|ID/)
  })

  it('commits one append command and restores exact nested snapshots with one Undo/Redo', () => {
    const history = createHistory(document(group('root', [block('bed', [0, 0, 0], 'red_bed')])))
    const plan = planDuplicate(history.document, ['root'], [4, 0, 0], catalog, options)
    const committed = executeHistory(history, applyDuplicatePlan(plan, history.document, base, catalog), 'Duplicate')
    expect(committed.past).toHaveLength(1)
    expect(committed.past[0].patches).toEqual(plan.patches)
    const undone = undoHistory(committed)
    expect(undone.document).toEqual(history.document)
    expect(redoHistory(undone).document).toEqual(plan.document)
  })
})

