import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import type { Vec3 } from '../core/schema'
import { executeHistory, redoHistory, undoHistory } from './history'
import { applyMaterialReplacement, MaterialReplacementError, planMaterialReplacement } from './material-plan'
import { newEditorDocument, sceneBlocks, type EditorObject } from './model'
import { createPlacedObject } from './placement'

const catalog = [...DEMO_MATERIALS]
const base = { documentId: 'document', sessionEpoch: 'epoch', revision: 3 }
const options = { base, operationId: 'replace' }
const intent = { sourceId: 'minecraft:oak_log', targetId: 'minecraft:spruce_log' }
function block(id: string, axis = 'y', pos: Vec3 = [0, 0, 0]): EditorObject {
  return createPlacedObject({ name: intent.sourceId, properties: { axis } }, pos, catalog, undefined, id)
}
function document(...objects: EditorObject[]) { return { ...newEditorDocument(), id: 'document', objects } }

describe('selected material replacement', () => {
  it('preserves mixed axes, identities, pivots and nested independent component provenance', () => {
    const group: EditorObject = { id: 'group', name: 'Group', kind: 'group', cells: [], children: [block('x', 'x'), { id: 'copy', name: 'Copy', kind: 'component', componentId: 'library', orientation: 2, pivot2: [5, 1, 1], cells: [], children: [block('z', 'z', [2, 0, 0])] }], pivot2: [3, 1, 1], orientation: 1 }
    const source = document(group, block('unselected', 'y', [4, 0, 0])), snapshot = structuredClone(source)
    const plan = planMaterialReplacement(source, ['group'], intent, catalog, options)
    expect(plan).toMatchObject({ matchedCells: 2, matchedObjects: 2, selectedRoots: 1, selection: ['group'], addedObjectIds: [], cost: { addedCells: 0, addedObjects: 0, resultCells: 3, resultObjects: 5 } })
    expect(plan.cells.map(cell => cell.state)).toEqual(['x', 'z'].map(axis => ({ name: intent.targetId, properties: { axis } })))
    const expected = structuredClone(source)
    expected.objects[0].children[0].cells[0].state.name = intent.targetId
    expected.objects[0].children[1].children[0].cells[0].state.name = intent.targetId
    expect(plan.document).toEqual(expected)
    expect(plan.document.objects[1]).toBe(source.objects[1])
    expect(applyMaterialReplacement(plan, source, base, catalog)).toBe(plan.document)
    expect(source).toEqual(snapshot)
    const history = executeHistory({ document: source, past: [], future: [] }, plan.document, 'Replace material')
    expect(history.past).toHaveLength(1)
    expect(undoHistory(history).document).toEqual(source)
    expect(redoHistory(undoHistory(history)).document).toEqual(plan.document)
  })

  it('reports every incompatible match and never drops or invents properties', () => {
    const source = document(block('x'), block('z', 'z', [2, 0, 0]))
    for (const targetId of ['minecraft:stone', 'minecraft:missing']) {
      try { planMaterialReplacement(source, ['x', 'z'], { ...intent, targetId }, catalog, options); expect.fail('Must reject incompatible replacement') }
      catch (error) {
        expect(error).toBeInstanceOf(MaterialReplacementError)
        expect((error as MaterialReplacementError).report.matches).toHaveLength(2)
        expect((error as MaterialReplacementError).report.matches.every(match => !match.compatibility.supported)).toBe(true)
      }
    }
    const restricted = catalog.map(material => material.id === intent.targetId ? { ...material, properties: {} } : material)
    expect(() => planMaterialReplacement(source, ['x'], intent, restricted, options)).toThrow(/Property domains differ/)
    expect(source.objects[0].cells[0].state).toEqual({ name: intent.sourceId, properties: { axis: 'y' } })
  })

  it('rejects empty, duplicate, missing, no-match and identical requests distinctly', () => {
    const source = document(block('x'))
    expect(() => planMaterialReplacement(source, [], intent, catalog, options)).toThrow(/Select top-level/)
    expect(() => planMaterialReplacement(source, ['x', 'x'], intent, catalog, options)).toThrow(/distinct/)
    expect(() => planMaterialReplacement(source, ['missing'], intent, catalog, options)).toThrow(/missing/)
    expect(() => planMaterialReplacement(source, ['x'], { ...intent, sourceId: 'minecraft:stone' }, catalog, options)).toThrow(/No selected cells/)
    expect(() => planMaterialReplacement(source, ['x'], { ...intent, targetId: intent.sourceId }, catalog, options)).toThrow(/identical/)
  })

  it('guards budget, stale source, revisions, epochs, policy identity and cancellation', () => {
    const source = document(block('x')), controller = new AbortController()
    const plan = planMaterialReplacement(source, ['x'], intent, catalog, { ...options, signal: controller.signal })
    expect(() => planMaterialReplacement(source, ['x'], intent, catalog, { ...options, budget: { maxCells: 0, maxObjects: 1 } })).toThrow(/budget/)
    for (const stale of [{ ...base, revision: 4 }, { ...base, sessionEpoch: 'other' }]) expect(() => applyMaterialReplacement(plan, source, stale, catalog)).toThrow(/document changed/)
    expect(() => applyMaterialReplacement(plan, { ...source }, base, catalog)).toThrow(/document changed/)
    const rules: NeighborRules = {}
    expect(() => applyMaterialReplacement(plan, source, base, catalog, rules)).toThrow(/Auto connections changed/)
    const policyPlan = planMaterialReplacement(source, ['x'], intent, catalog, options, rules)
    expect(() => applyMaterialReplacement(policyPlan, source, base, catalog, {})).toThrow(/Auto connections changed/)
    expect(applyMaterialReplacement(policyPlan, source, base, catalog, rules)).toBe(policyPlan.document)
    controller.abort()
    expect(() => applyMaterialReplacement(plan, source, base, catalog)).toThrow(/cancelled/)
    expect(() => planMaterialReplacement(source, ['x'], intent, catalog, { ...options, signal: controller.signal })).toThrow(/cancelled/)
  })

  it.each([
    ['minecraft:stone_brick_slab', 'minecraft:oak_slab', { type: 'double', waterlogged: 'true' }],
    ['minecraft:stone_brick_slab', 'minecraft:oak_slab', { type: 'top', waterlogged: 'false' }],
    ['minecraft:oak_stairs', 'minecraft:spruce_stairs', { facing: 'west', half: 'top', shape: 'inner_right', waterlogged: 'true' }],
    ['minecraft:oak_stairs', 'minecraft:spruce_stairs', { facing: 'south', half: 'bottom', shape: 'outer_left', waterlogged: 'false' }],
    ['minecraft:oak_planks', 'minecraft:birch_planks', {}],
    ['minecraft:stone', 'minecraft:stone_bricks', {}],
  ] satisfies [string, string, Record<string, string>][])('preserves the full %s state when replacing with %s', (sourceId, targetId, properties) => {
    const sourceMaterial = catalog.find(material => material.id === sourceId)!
    const targetMaterial: Material = { ...sourceMaterial, id: targetId, label: targetId }
    const registry = [...catalog.filter(material => material.id !== targetId), targetMaterial]
    const object = { ...createPlacedObject({ name: sourceId, properties }, [-7, 4, 11], registry, undefined, 'material-object'), orientation: 3 as const, pivot2: [-12, 10, 24] as Vec3 }
    const source = document(object, block('unselected', 'z', [20, 0, 0]))
    const snapshot = structuredClone(source)
    const plan = planMaterialReplacement(source, [object.id], { sourceId, targetId }, registry, options)
    const expected = structuredClone(snapshot)
    expected.objects[0].cells[0].state.name = targetId
    expect(plan.document).toEqual(expected)
    expect(plan.cells).toEqual([{ pos: [-7, 4, 11], state: { name: targetId, properties }, owner: object.id }])
    expect(plan.document.objects[0].cells[0].state.properties).not.toBe(properties)
    expect(plan).toMatchObject({ matchedCells: 1, matchedObjects: 1, selection: [object.id], addedObjectIds: [], cost: { addedObjects: 0, addedCells: 0, resultObjects: 2, resultCells: 2 } })
    expect(applyMaterialReplacement(plan, source, base, registry)).toBe(plan.document)
    expect(source).toEqual(snapshot)
  })

  it('preserves complete door and bed pairs with all explicit states', () => {
    const paired: Material[] = []
    for (const [sourceId, targetId, properties, defaults] of [
      ['minecraft:red_bed', 'minecraft:blue_bed', { facing: ['north', 'east', 'south', 'west'], part: ['foot', 'head'], occupied: ['false', 'true'] }, { facing: 'east', part: 'foot', occupied: 'true' }],
      ['minecraft:oak_door', 'minecraft:spruce_door', { facing: ['north', 'east', 'south', 'west'], half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'], powered: ['false', 'true'] }, { facing: 'west', half: 'lower', hinge: 'right', open: 'true', powered: 'true' }],
    ] as [string, string, Record<string, string[]>, Record<string, string>][]) {
      for (const id of [sourceId, targetId]) paired.push({ id, label: id, color: '#fff', family: 'pair', properties, defaults })
      const registry = [...catalog, ...paired]
      const object = createPlacedObject(defaultState(sourceId, registry), [0, 0, 0], registry, undefined, 'pair')
      const source = document(object)
      const plan = planMaterialReplacement(source, ['pair'], { sourceId, targetId }, registry, options)
      expect(plan.matchedCells).toBe(2)
      expect(sceneBlocks(plan.document)).toEqual(sceneBlocks(source).map(cell => ({ ...cell, state: { ...cell.state, name: targetId } })))
      expect(plan.document.objects[0]).toMatchObject({ id: object.id, kind: 'multiblock', pivot2: object.pivot2, orientation: object.orientation })
    }
  })
})
