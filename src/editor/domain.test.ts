import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { Project, Vec3 } from '../core/schema'
import { createHistory, executeHistory, redoHistory, undoHistory } from './history'
import { componentAssetSchema, editorDocumentSchema, fromLegacyProject, newEditorDocument, objectCells, sceneBlocks, validateDocument, type EditorDocument, type EditorObject } from './model'
import { componentFromSelection, groupObjects, insertObject, instantiateComponent, moveObjects, previewTransform, removeObjects, rotateObjects, selectionPivot2, setObjectPivot, ungroupObjects, updateObjectState } from './operations'
import { createPlacedObject } from './placement'

const bed: Material = { id: 'minecraft:red_bed', label: 'Red bed', family: 'bed', color: '#f00', defaults: { facing: 'north', part: 'foot', occupied: 'false' }, properties: { facing: ['north', 'east', 'south', 'west'], part: ['foot', 'head'], occupied: ['false', 'true'] } }
const catalog = [...DEMO_MATERIALS, bed]
function block(id: string, pos: Vec3 = [0, 0, 0], material = 'minecraft:stone'): EditorObject {
  return { ...createPlacedObject(defaultState(material, catalog), pos, catalog), id }
}
function document(...objects: EditorObject[]): EditorDocument { return { ...newEditorDocument(), objects } }

describe('editor document contracts', () => {
  it('re-anchors an even footprint explicitly without moving cells, then permits grid-safe rotation', () => {
    const grouped = groupObjects(document(block('a'), block('b', [1, 0, 0])), ['a', 'b'], 'Wall', catalog)
    const id = grouped.objects[0].id
    expect(() => rotateObjects(grouped, [id], 1, 'active', catalog)).toThrow(/parity/i)
    const reanchored = setObjectPivot(grouped, id, [1, 1, 1], catalog)
    expect(sceneBlocks(reanchored)).toEqual(sceneBlocks(grouped))
    const rotated = rotateObjects(reanchored, [id], 1, 'active', catalog)
    expect(sceneBlocks(rotated).map(cell => cell.pos)).toEqual([[0, 0, 0], [0, 0, 1]])
    const history = executeHistory(createHistory(grouped), reanchored, 'Re-anchor')
    expect(undoHistory(history).document).toEqual(grouped)
    expect(() => setObjectPivot(grouped, id, [0.5, 1, 1], catalog)).toThrow(/integer/i)
  })
  it('flattens nested cells under their selectable top-level owner', () => {
    const grouped = groupObjects(document(block('a'), block('b', [1, 0, 0])), ['a', 'b'], 'Wall', catalog)
    expect(sceneBlocks(grouped).map(cell => cell.owner)).toEqual([grouped.objects[0].id, grouped.objects[0].id])
    expect(objectCells(grouped.objects[0])).toHaveLength(2)
  })
  it('rejects duplicate nested IDs, collisions and incomplete logical pairs', () => {
    const a = block('a'), duplicate = { ...block('a', [1, 0, 0]) }
    expect(() => groupObjects(document(a, duplicate), ['a'], 'Group', catalog)).toThrow()
    expect(editorDocumentSchema.safeParse(document(a, duplicate)).success).toBe(false)
    expect(() => insertObject(document(a), block('b'), catalog)).toThrow(/collision/i)
    const pair = createPlacedObject(defaultState(bed.id, catalog), [2, 0, 0], catalog)
    expect(() => validateDocument(document({ ...pair, kind: 'block', cells: [pair.cells[0]] }), catalog)).toThrow(/pair/i)
  })
  it('rejects excessive depth, cyclic data, unknown fields and illegal properties', () => {
    let nested = block('leaf')
    for (let index = 0; index < 16; index++) nested = { id: `group-${index}`, name: 'Group', kind: 'group', cells: [], children: [nested], pivot2: [1, 1, 1], orientation: 0 }
    expect(editorDocumentSchema.safeParse(document(nested)).success).toBe(false)
    const cycle = { ...nested, children: [] as EditorObject[] }; cycle.children.push(cycle)
    expect(editorDocumentSchema.safeParse(document(cycle)).success).toBe(false)
    const unknown = { ...block('a'), extraPayload: { preserve: true } }
    expect(editorDocumentSchema.safeParse(document(unknown)).success).toBe(false)
    const badState = block('a'); badState.cells[0].state.properties.unknown = 'true'
    expect(() => validateDocument(document(badState), catalog)).toThrow()
  })
  it('rejects total cell and object limits before recursive schema parsing', () => {
    const huge = { ...block('huge'), kind: 'component' as const, cells: Array.from({ length: 100001 }, (_, index) => ({ pos: [index, 0, 0], state: defaultState('minecraft:stone') })) }
    expect(editorDocumentSchema.safeParse(document(huge as EditorObject)).success).toBe(false)
  })
})

describe('integer transforms and groups', () => {
  it('rotates positions and facing states clockwise with four-turn invariance', () => {
    const a = block('a', [-2, 0, -2], 'minecraft:oak_stairs'), b = block('b', [0, 1, 0], 'minecraft:oak_log')
    let result = groupObjects(document(a, b), ['a', 'b'], 'Nested architecture', catalog)
    const initial = structuredClone(result), id = result.objects[0].id
    for (let index = 0; index < 4; index++) result = rotateObjects(result, [id], 1, 'active', catalog)
    expect(result).toEqual(initial)
    const clockwise = rotateObjects(document(a), ['a'], 1, 'active', catalog)
    expect(clockwise.objects[0].cells[0].state.properties.facing).toBe('east')
    expect(clockwise.objects[0].orientation).toBe(1)
  })
  it('uses exact even pivots and rejects mixed horizontal pivot parity', () => {
    const square = document(block('a'), block('b', [1, 0, 1]))
    expect(selectionPivot2(square, ['a', 'b'], 'selection')).toEqual([2, 1, 2])
    const rotated = rotateObjects(square, ['a', 'b'], 1, 'selection', catalog)
    expect(rotated.objects.map(object => object.cells[0].pos)).toEqual([[1, 0, 0], [0, 0, 1]])
    const rectangle = document(block('a'), block('b', [1, 0, 0]))
    const before = structuredClone(rectangle)
    expect(selectionPivot2(rectangle, ['a', 'b'], 'selection')).toEqual([2, 1, 1])
    expect(() => rotateObjects(rectangle, ['a', 'b'], 1, 'selection', catalog)).toThrow(/parity/i)
    expect(rotateObjects(rectangle, ['a', 'b'], 2, 'selection', catalog).objects[0].cells[0].pos).toEqual([1, 0, 0])
    expect(rectangle).toEqual(before)
  })
  it('uses the last selected orientation for local movement and active pivot', () => {
    const a = { ...block('a'), orientation: 1 as const }, b = block('b', [5, 0, 0])
    const source = document(a, b)
    const result = moveObjects(source, ['b', 'a'], [1, 0, 0], 'local', catalog)
    expect(result.objects.map(object => object.cells[0].pos)).toEqual([[0, 0, 1], [5, 0, 1]])
    expect(selectionPivot2(source, ['b', 'a'], 'active')).toEqual(a.pivot2)
    expect(source.objects[0].cells[0].pos).toEqual([0, 0, 0])
  })
  it('rotates each object around its individual origin', () => {
    const source = document(block('a'), block('b', [2, 0, 0], 'minecraft:oak_stairs'))
    const result = rotateObjects(source, ['a', 'b'], 1, 'individual', catalog)
    expect(result.objects.map(object => object.cells[0].pos)).toEqual([[0, 0, 0], [2, 0, 0]])
    expect(result.objects[1].cells[0].state.properties.facing).toBe('east')
  })
  it('rejects fractional transforms and unknown rotation adapters', () => {
    const source = document(block('a'))
    expect(() => moveObjects(source, ['a'], [0.5, 0, 0], 'global', catalog)).toThrow(/integer/i)
    expect(() => rotateObjects(source, ['a'], 0.5, 'active', catalog)).toThrow(/quarter/i)
    const custom: Material = { id: 'custom:directional', label: 'Custom', family: 'custom', color: '#fff', properties: { orientation: ['north_up', 'east_up'] }, defaults: { orientation: 'north_up' } }
    const object = createPlacedObject(defaultState(custom.id, [custom]), [0, 0, 0], [custom])
    expect(() => rotateObjects(document(object), [object.id], 1, 'active', [custom])).toThrow(/adapter/i)
  })
  it('keeps children IDs, metadata and states through grouping and ungrouping', () => {
    const source = document(block('a'), block('middle', [8, 0, 0]), block('b', [2, 0, 0], 'minecraft:oak_stairs'))
    const grouped = groupObjects(source, ['a', 'b'], 'Arch', catalog)
    const moved = moveObjects(grouped, [grouped.objects[0].id], [0, 2, 0], 'global', catalog)
    const restored = ungroupObjects(moved, [grouped.objects[0].id], catalog)
    expect(restored.objects.map(object => object.id)).toEqual(['a', 'b', 'middle'])
    expect(restored.objects[1].cells[0].state).toEqual(source.objects[2].cells[0].state)
    expect(restored.objects[0].pivot2).toEqual([1, 5, 1])
    expect(source.objects[0].cells[0].pos).toEqual([0, 0, 0])
  })
  it('rejects a collision in the second part without mutating any object', () => {
    const pair = createPlacedObject(defaultState(bed.id, catalog), [0, 0, 0], catalog)
    const source = document(pair, block('obstacle', [2, 0, -1])), before = structuredClone(source)
    expect(() => moveObjects(source, [pair.id], [2, 0, 0], 'global', catalog)).toThrow(/collision/i)
    expect(source).toEqual(before)
    const preview = previewTransform(source, [pair.id], { kind: 'move', delta: [2, 0, 0] }, 'global', 'active', catalog)
    expect(preview.valid).toBe(false)
    expect(preview.document).toBeNull()
    expect(preview.blocks.map(cell => cell.pos)).toEqual([[2, 0, 0], [2, 0, -1]])
    expect(preview.blocks.every(cell => cell.owner === pair.id)).toBe(true)
  })
  it('updates whole paired states atomically and rejects editing structural parts', () => {
    const pair = createPlacedObject(defaultState(bed.id, catalog), [0, 0, 0], catalog)
    const source = document(pair)
    const changed = updateObjectState(source, pair.id, 'facing', 'east', catalog)
    expect(changed.objects[0].cells.map(cell => cell.pos)).toEqual([[0, 0, 0], [1, 0, 0]])
    expect(changed.objects[0].cells.every(cell => cell.state.properties.facing === 'east')).toBe(true)
    expect(() => updateObjectState(source, pair.id, 'part', 'head', catalog)).toThrow(/whole/i)
    expect(() => updateObjectState(document(pair, block('obstacle', [1, 0, 0])), pair.id, 'facing', 'east', catalog)).toThrow(/collision/i)
  })
})

describe('components and explicit legacy conversion', () => {
  it('creates normalized reusable assets and independent instances', () => {
    const source = document(block('a', [10, 2, -4]), block('b', [11, 2, -3], 'minecraft:oak_stairs'))
    const asset = componentFromSelection(source, ['a', 'b'], 'Corner')
    expect(asset.size).toEqual([2, 1, 2])
    expect(asset.objects[0].cells[0].pos).toEqual([0, 0, 0])
    expect(componentAssetSchema.safeParse(asset).success).toBe(true)
    const first = instantiateComponent(asset, [0, 0, 0]), second = instantiateComponent(asset, [4, 0, 0])
    const beforeAsset = structuredClone(asset), beforeSecond = structuredClone(second)
    first.children[0].cells[0].state.properties.extra = 'true'
    expect(asset).toEqual(beforeAsset)
    expect(second).toEqual(beforeSecond)
    expect(first.children[0].id).not.toBe(second.children[0].id)
    expect(first.componentId).toBe(asset.id)
    expect(source.objects[0].cells[0].pos).toEqual([10, 2, -4])
  })
  it('explicitly flattens legacy instances while preserving IDs/entities and coalescing pairs', () => {
    const pair = createPlacedObject(defaultState(bed.id, catalog), [0, 0, 0], catalog)
    const legacy: Project = { schemaVersion: 1, id: 'legacy', name: 'Legacy project', target: { gameVersion: '26.2', dataVersion: 4903 }, blocks: [...pair.cells].reverse(), components: [{ id: 'column', name: 'Column', category: 'column', blocks: block('unused').cells }], instances: [{ id: 'instance-1', componentId: 'column', position: [5, 0, 0], rotation: 1, substitutions: {} }], entities: [{ id: 'pig-1', type: 'minecraft:pig', position: [0.5, 0, 2.5], yaw: 35 }] }
    const before = structuredClone(legacy), converted = fromLegacyProject(legacy)
    validateDocument(converted, catalog)
    expect(converted.id).toBe('legacy')
    expect(converted.objects[0].kind).toBe('multiblock')
    expect(converted.objects[1].id).toBe('instance-1')
    expect(converted.entities).toEqual(legacy.entities)
    expect(legacy).toEqual(before)
    expect(() => fromLegacyProject({ ...legacy, blocks: [pair.cells[0]] })).toThrow(/pair/i)
  })
})

describe('atomic patch history', () => {
  it('undoes and redoes grouping, transforms, state changes and removal as one command each', () => {
    const initial = document(block('a'), block('b', [2, 0, 0]), block('c', [4, 0, 0]))
    let history = createHistory(initial)
    const grouped = groupObjects(history.document, ['a', 'b'], 'Group', catalog)
    history = executeHistory(history, grouped, 'Group')
    expect(history.past[0].patches.map(patch => patch.id)).not.toContain('c')
    const moved = moveObjects(history.document, [grouped.objects[0].id], [0, 1, 0], 'global', catalog)
    history = executeHistory(history, moved, 'Move')
    expect(history.past).toHaveLength(2)
    history = undoHistory(history)
    expect(history.document).toEqual(grouped)
    history = undoHistory(history)
    expect(history.document).toEqual(initial)
    history = redoHistory(redoHistory(history))
    expect(history.document).toEqual(moved)
    history = executeHistory(history, removeObjects(history.document, ['c'], catalog), 'Delete')
    expect(history.past.at(-1)?.patches).toHaveLength(1)
    expect(undoHistory(history).document).toEqual(moved)
  })
  it('preserves object order for inserts, removals and redo and truncates future on a new command', () => {
    const initial = document(block('a'), block('b', [2, 0, 0]), block('c', [4, 0, 0]))
    const removed = removeObjects(initial, ['a'], catalog)
    let history = executeHistory(createHistory(initial), removed, 'Delete')
    expect(history.past[0].patches).toHaveLength(1)
    history = undoHistory(history)
    expect(history.document.objects.map(object => object.id)).toEqual(['a', 'b', 'c'])
    expect(redoHistory(history).document).toEqual(removed)
    history = executeHistory(history, moveObjects(history.document, ['b'], [0, 1, 0], 'global', catalog), 'Move')
    expect(history.future).toHaveLength(0)
    expect(executeHistory(history, structuredClone(history.document), 'No change')).toBe(history)
  })
  it('stores immutable object patches and retains at most 64 commands', () => {
    let history = createHistory(document(block('a')))
    for (let index = 0; index < 70; index++) history = executeHistory(history, moveObjects(history.document, ['a'], [1, 0, 0], 'global', catalog), 'Move')
    expect(history.past).toHaveLength(64)
    const expected = history.past.at(-1)!.patches[0].after!.object.cells[0].pos[0]
    history.document.objects[0].cells[0].pos[0] = 999
    expect(history.past.at(-1)!.patches[0].after!.object.cells[0].pos[0]).toBe(expected)
    expect(redoHistory(undoHistory(history)).document.objects[0].cells[0].pos[0]).toBe(expected)
  })
})
