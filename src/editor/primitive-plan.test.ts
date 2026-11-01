import { describe, expect, it, vi } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { BlockState, Vec3 } from '../core/schema'
import { createHistory, executeHistory, redoHistory, undoHistory } from './history'
import { newEditorDocument, type EditorDocument, type EditorObject } from './model'
import { createPlacedObject } from './placement'
import { applyPrimitivePlan, planPrimitive, type PrimitiveIntent } from './primitive-plan'

const catalog: Material[] = [...DEMO_MATERIALS,
  { id: 'minecraft:air', label: 'Air', family: 'air', color: '#fff', properties: {}, defaults: {} },
  { id: 'minecraft:red_bed', label: 'Bed', family: 'bed', color: '#aaa', properties: { facing: ['north', 'east', 'south', 'west'], part: ['foot', 'head'], occupied: ['false', 'true'] }, defaults: { facing: 'east', part: 'foot', occupied: 'false' } },
  { id: 'minecraft:oak_door', label: 'Door', family: 'door', color: '#aaa', properties: { facing: ['north', 'east', 'south', 'west'], half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'], powered: ['false', 'true'] }, defaults: { facing: 'north', half: 'lower', hinge: 'left', open: 'false', powered: 'false' } },
  { id: 'minecraft:sunflower', label: 'Sunflower', family: 'plant', color: '#aaa', properties: { half: ['lower', 'upper'] }, defaults: { half: 'lower' } },
]
const base = { documentId: 'document', sessionEpoch: 'session', revision: 7 }
const options = { base, operationId: 'primitive' }
const stone = defaultState('minecraft:stone', catalog)
function document(...objects: EditorObject[]): EditorDocument { return { ...newEditorDocument(), id: 'document', objects } }
function intent(start: Vec3, end: Vec3, kind: PrimitiveIntent['kind'] = 'line', state: BlockState = stone): PrimitiveIntent { return { kind, start, end, state } }
function positions(start: Vec3, end: Vec3, kind: PrimitiveIntent['kind'] = 'line') { return planPrimitive(document(), intent(start, end, kind), catalog, options).cells.map(cell => cell.pos) }

describe('inclusive World primitive plans', () => {
  it('includes both endpoints along each World line axis', () => {
    expect(positions([-2, 3, -4], [0, 3, -4])).toEqual([[-2, 3, -4], [-1, 3, -4], [0, 3, -4]])
    expect(positions([-2, 1, -4], [-2, 3, -4])).toEqual([[-2, 1, -4], [-2, 2, -4], [-2, 3, -4]])
    expect(positions([-2, 3, -4], [-2, 3, -2])).toEqual([[-2, 3, -4], [-2, 3, -3], [-2, 3, -2]])
  })

  it('enumerates XY, XZ and YZ planes X fastest then Y then Z', () => {
    expect(positions([-1, -1, 2], [0, 0, 2], 'plane')).toEqual([[-1, -1, 2], [0, -1, 2], [-1, 0, 2], [0, 0, 2]])
    expect(positions([-1, 2, -1], [0, 2, 0], 'plane')).toEqual([[-1, 2, -1], [0, 2, -1], [-1, 2, 0], [0, 2, 0]])
    expect(positions([2, -1, -1], [2, 0, 0], 'plane')).toEqual([[2, -1, -1], [2, 0, -1], [2, -1, 0], [2, 0, 0]])
  })

  it('normalizes reversed negative corners and permits point and line degenerates', () => {
    const source = document()
    const forward = planPrimitive(source, intent([-3, -2, 4], [-1, -1, 4], 'plane'), catalog, options)
    const reverse = planPrimitive(source, intent([-1, -1, 4], [-3, -2, 4], 'plane'), catalog, options)
    expect(reverse).toEqual(forward)
    expect(reverse).toMatchObject({ anchor: [-3, -2, 4], size: [3, 2, 1], anchors: 6 })
    expect(positions([1, 2, 3], [1, 2, 3])).toEqual([[1, 2, 3]])
    expect(positions([1, 2, 3], [1, 2, 3], 'plane')).toEqual([[1, 2, 3]])
    expect(positions([1, 2, 3], [2, 2, 3], 'plane')).toEqual([[1, 2, 3], [2, 2, 3]])
  })

  it('rejects diagonal lines and full three dimensional plane bounds', () => {
    expect(() => positions([0, 0, 0], [1, 1, 0])).toThrow(/axis/i)
    expect(() => positions([0, 0, 0], [1, 1, 1], 'plane')).toThrow(/coordinate/i)
  })

  it('keeps preview IDs stable and requires fresh IDs for subsequent operations', () => {
    const source = document()
    const first = planPrimitive(source, intent([0, 0, 0], [1, 0, 0]), catalog, options)
    expect(first.addedObjectIds).toEqual(['primitive:0', 'primitive:1'])
    expect(planPrimitive(source, intent([4, 0, 0], [5, 0, 0]), catalog, options).addedObjectIds).toEqual(first.addedObjectIds)
    const next = { base: { ...base, revision: 8 }, operationId: 'next' }
    expect(planPrimitive(first.document, intent([4, 0, 0], [5, 0, 0]), catalog, next).selection).toEqual(['next:0', 'next:1'])
    expect(() => planPrimitive(first.document, intent([4, 0, 0], [5, 0, 0]), catalog, { ...next, operationId: 'primitive' })).toThrow(/conflict/i)
  })

  it('preserves explicit log, slab and stairs properties without neighbor updates', () => {
    for (const state of [
      { name: 'minecraft:oak_log', properties: { axis: 'z' } },
      { name: 'minecraft:stone_brick_slab', properties: { type: 'top', waterlogged: 'true' } },
      { name: 'minecraft:oak_stairs', properties: { facing: 'west', half: 'top', shape: 'inner_right', waterlogged: 'true' } },
    ] as BlockState[]) {
      const plan = planPrimitive(document(), intent([0, 0, 0], [1, 0, 0], 'line', state), catalog, options)
      expect(plan.cells.map(cell => cell.state)).toEqual([state, state])
      expect(plan.cells[0].state.properties).not.toBe(plan.cells[1].state.properties)
      expect(plan.cells[0].state.properties).not.toBe(state.properties)
    }
  })

  it('creates complete beds perpendicular to their facing and canonicalizes only part', () => {
    const state = { name: 'minecraft:red_bed', properties: { facing: 'east', part: 'head', occupied: 'true' } }
    const plan = planPrimitive(document(), intent([0, 0, 0], [0, 0, 1], 'line', state), catalog, options)
    expect(plan.cells.map(cell => cell.pos)).toEqual([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]])
    expect(plan.cells.map(cell => cell.state.properties)).toEqual([0, 1, 0, 1].map(part => ({ ...state.properties, part: part ? 'head' : 'foot' })))
    expect(plan.cost.addedCells).toBe(4)
    expect(plan.document.objects.map(object => object.kind)).toEqual(['multiblock', 'multiblock'])
  })

  it('allows door and plant footprints outside a plane and preserves door settings', () => {
    for (const name of ['minecraft:oak_door', 'minecraft:sunflower']) {
      const state = defaultState(name, catalog)
      state.properties.half = 'upper'
      if (name.endsWith('door')) Object.assign(state.properties, { hinge: 'right', open: 'true', powered: 'true', facing: 'west' })
      const plan = planPrimitive(document(), intent([0, 0, 0], [1, 0, 1], 'plane', state), catalog, options)
      expect(plan.cells.map(cell => cell.pos)).toEqual([[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 1]])
      expect(plan.cells.map(cell => cell.state.properties)).toEqual(Array.from({ length: 8 }, (_, index) => ({ ...state.properties, half: index % 2 ? 'upper' : 'lower' })))
    }
  })

  it('rejects overlapping bed and vertical door or plant footprints atomically', () => {
    const source = document()
    for (const [name, end] of [['minecraft:red_bed', [1, 0, 0]], ['minecraft:oak_door', [0, 1, 0]], ['minecraft:sunflower', [0, 1, 0]]] as const) {
      expect(() => planPrimitive(source, intent([0, 0, 0], [...end], 'line', defaultState(name, catalog)), catalog, options)).toThrow(/collision/i)
    }
    expect(source.objects).toEqual([])
  })

  it('rejects any existing occupied cell including explicit air and unselected groups', () => {
    for (const name of ['minecraft:stone', 'minecraft:air']) {
      const obstacle = createPlacedObject(defaultState(name, catalog), [2, 0, 0], catalog, undefined, 'obstacle')
      const group: EditorObject = { id: 'group', name: 'group', kind: 'group', cells: [], children: [obstacle], pivot2: [5, 1, 1], orientation: 0 }
      const source = document(group)
      expect(() => planPrimitive(source, intent([0, 0, 0], [2, 0, 0]), catalog, options)).toThrow(/collision/i)
      expect(source.objects).toEqual([group])
    }
  })

  it('validates coordinate bounds and complete pair overflow and translates integer pivots', () => {
    for (const point of [[0.5, 0, 0], [30000001, 0, 0], [0, -2049, 0], [0, 0, Infinity]] as Vec3[]) expect(() => positions(point, point)).toThrow()
    const plan = planPrimitive(document(), intent([-30000000, -2048, 30000000], [-30000000, -2047, 30000000]), catalog, options)
    expect(plan.document.objects.map(object => object.pivot2)).toEqual([[-59999999, -4095, 60000001], [-59999999, -4093, 60000001]])
    expect(() => planPrimitive(document(), intent([0, 2048, 0], [0, 2048, 0], 'line', defaultState('minecraft:oak_door', catalog)), catalog, options)).toThrow()
    expect(() => planPrimitive(document(), intent([30000000, 0, 0], [30000000, 0, 0], 'line', defaultState('minecraft:red_bed', catalog)), catalog, options)).toThrow()
  })

  it('prebounds anchor products and multiplied object and complete-pair cell budgets', () => {
    const huge = intent([-30000000, 0, 0], [30000000, 0, 0])
    Object.defineProperty(huge, 'state', { get() { throw new Error('must not inspect state before anchor bound') } })
    expect(() => planPrimitive(document(), huge, catalog, options)).toThrow(/100,000 anchors/i)
    const source = document(createPlacedObject(stone, [20, 0, 0], catalog, undefined, 'existing'))
    const pair = intent([0, 0, 0], [0, 0, 1], 'line', defaultState('minecraft:red_bed', catalog))
    expect(planPrimitive(source, pair, catalog, { ...options, budget: { maxObjects: 3, maxCells: 5 } }).cost).toEqual({ addedObjects: 2, addedCells: 4, resultObjects: 3, resultCells: 5 })
    for (const budget of [{ maxObjects: 2, maxCells: 5 }, { maxObjects: 3, maxCells: 4 }]) expect(() => planPrimitive(source, pair, catalog, { ...options, budget })).toThrow(/budget/i)
    Object.defineProperty(source.objects[0].cells[0], 'state', { get() { throw new Error('must not expand before budget') } })
    expect(() => planPrimitive(source, intent([0, 0, 0], [99999, 0, 0]), catalog, options)).toThrow(/budget/i)
  })

  it('leaves source objects and free entities untouched and never requests random IDs while planning', () => {
    const source = document(createPlacedObject(stone, [20, 0, 0], catalog, undefined, 'existing'))
    source.entities = [{ id: 'pig', type: 'minecraft:pig', position: [1, 2, 3], yaw: 90 }]
    const snapshot = structuredClone(source)
    const random = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('unexpected RNG') })
    try {
      const plan = planPrimitive(source, intent([0, 0, 0], [1, 0, 0]), catalog, options)
      expect(source).toEqual(snapshot)
      expect(plan.document.objects[0]).toBe(source.objects[0])
      expect(plan.document.entities).toBe(source.entities)
      expect(random).not.toHaveBeenCalled()
    } finally { random.mockRestore() }
  })

  it('applies the exact candidate with stale and cancellation guards and one undo/redo step', () => {
    const history = createHistory(document()), controller = new AbortController()
    const plan = planPrimitive(history.document, intent([0, 0, 0], [1, 0, 1], 'plane'), catalog, { ...options, signal: controller.signal })
    expect(applyPrimitivePlan(plan, history.document, base, catalog)).toBe(plan.document)
    expect(() => applyPrimitivePlan(plan, structuredClone(history.document), base, catalog)).toThrow(/changed/i)
    for (const current of [{ ...base, revision: 8 }, { ...base, sessionEpoch: 'next' }]) expect(() => applyPrimitivePlan(plan, history.document, current, catalog)).toThrow(/changed/i)
    expect(() => applyPrimitivePlan(plan, { ...history.document, id: 'other' }, { ...base, documentId: 'other' }, catalog)).toThrow(/changed/i)
    const committed = executeHistory(history, applyPrimitivePlan(plan, history.document, base, catalog), 'Plane')
    expect(committed.past).toHaveLength(1)
    expect(committed.past[0].patches).toEqual(plan.patches)
    expect(undoHistory(committed).document).toEqual(history.document)
    expect(redoHistory(undoHistory(committed)).document).toEqual(plan.document)
    controller.abort()
    expect(() => applyPrimitivePlan(plan, history.document, base, catalog)).toThrow(/cancelled/i)
    expect(() => planPrimitive(history.document, intent([0, 0, 0], [1, 0, 0]), catalog, { ...options, signal: controller.signal })).toThrow(/cancelled/i)
  })
})


