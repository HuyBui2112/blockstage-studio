import { describe, expect, it } from 'vitest'
import { defaultState, DEMO_MATERIALS, type Material } from '../core/catalog'
import { enableMeasurementPhases, type MeasurementPhase } from '../core/measurement-phases'
import type { Vec3 } from '../core/schema'
import { newEditorDocument, type EditorDocument, type EditorObject, type CoordinateSpace, type PivotMode } from './model'
import { createPlacedObject } from './placement'
import { createTransformPreviewSession, previewTransform, type TransformIntent } from './operations'

const facing = ['north', 'east', 'south', 'west']
const material = (id: string, properties: Record<string, string[]>, defaults: Record<string, string>): Material => ({ id: `minecraft:${id}`, label: id, family: id, color: '#aaa', properties, defaults })
const catalog = [...DEMO_MATERIALS,
  material('red_bed', { facing, part: ['foot', 'head'], occupied: ['false', 'true'] }, { facing: 'north', part: 'foot', occupied: 'false' }),
  material('oak_door', { facing, half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'] }, { facing: 'north', half: 'lower', hinge: 'left', open: 'false' }),
  material('sunflower', { half: ['lower', 'upper'] }, { half: 'lower' }),
  material('odd', { orientation: ['north'] }, { orientation: 'north' }),
  material('restricted', { facing: ['north'] }, { facing: 'north' }),
]
const placed = (id: string, pos: Vec3 = [0, 0, 0], name = 'minecraft:stone') => createPlacedObject(defaultState(name, catalog), pos, catalog, undefined, id)
const document = (...objects: EditorObject[]): EditorDocument => ({ ...newEditorDocument(), objects })
const move: TransformIntent = { kind: 'move', delta: [2, 0, -3] }
function parity(base: EditorDocument, ids: string[], intent: TransformIntent, space: CoordinateSpace = 'global', pivot: PivotMode = 'active') {
  const before = structuredClone(base), materials = structuredClone(catalog)
  const actual = createTransformPreviewSession(base, catalog).preview(ids, intent, space, pivot)
  expect(actual).toEqual(previewTransform(base, ids, intent, space, pivot, catalog))
  expect(base).toEqual(before)
  expect(catalog).toEqual(materials)
  return actual
}

describe('immutable gesture transform preview validation', () => {
  it('matches move/local orientation and every rotation pivot on complete roots', () => {
    for (const name of ['stone', 'red_bed', 'oak_door', 'sunflower']) {
      const child = placed('child', [-3, 2, -4], `minecraft:${name}`)
      const group: EditorObject = { id: 'group', name: 'Group', kind: 'group', cells: [], children: [child], pivot2: [-5, 5, -7], orientation: 1 }
      const component: EditorObject = { ...group, id: 'component', kind: 'component', componentId: 'asset' }
      for (const root of [child, group, component]) {
        const base = document(root)
        for (const space of ['global', 'local'] as const) expect(parity(base, [root.id], move, space).valid).toBe(true)
        for (const pivot of ['active', 'individual', 'selection'] as const) for (const turns of [-1, 1, 2, 4]) parity(base, [root.id], { kind: 'rotate', turns }, 'global', pivot)
      }
    }
  })

  it('matches parity rejection, selected collisions, unselected collisions and vacated selected cells', () => {
    const base = document(placed('a'), placed('b', [1, 0, 0]))
    expect(parity(base, ['a', 'b'], { kind: 'rotate', turns: 1 }, 'global', 'selection').valid).toBe(false)
    expect(parity(base, ['a'], { kind: 'move', delta: [1, 0, 0] }).valid).toBe(false)
    expect(parity(base, ['a', 'b'], { kind: 'move', delta: [1, 0, 0] }).valid).toBe(true)
    const overlap = document(placed('a'), placed('b', [2, 0, 0]))
    expect(parity(overlap, ['a', 'b'], { kind: 'rotate', turns: 1 }, 'global', 'individual').valid).toBe(true)
    // Individual pivots can converge whole selected roots.
    overlap.objects[1].pivot2 = [3, 1, 1]
    expect(parity(overlap, ['a', 'b'], { kind: 'rotate', turns: 2 }, 'global', 'individual').valid).toBe(false)
  })

  it('matches bounds, invalid vectors/turns and legal-state adapter rejections', () => {
    const base = document(placed('a', [-30000000, 0, 0]))
    for (const delta of [[-1, 0, 0], [0, 4097, 0], [0.5, 0, 0], [Number.MAX_SAFE_INTEGER, 0, 0]] as Vec3[]) expect(parity(base, ['a'], { kind: 'move', delta }).valid).toBe(false)
    expect(parity(base, ['a'], { kind: 'rotate', turns: 0.5 }).valid).toBe(false)
    for (const id of ['odd', 'restricted']) expect(parity(document(placed('a', [0, 0, 0], `minecraft:${id}`)), ['a'], { kind: 'rotate', turns: 1 }).valid).toBe(false)
  })

  it('keeps exact public diagnostics when simultaneous failures have different priorities', () => {
    const root: EditorObject = { id: 'group', name: 'Group', kind: 'group', cells: [], children: [placed('a', [0, 0, 0], 'minecraft:restricted'), placed('b', [1, 0, 0])], pivot2: [1, 1, 1], orientation: 0 }
    const base = document(root, placed('obstacle', [0, 0, 1]))
    const intent: TransformIntent = { kind: 'rotate', turns: 1 }
    const full = previewTransform(base, ['group'], intent, 'global', 'active', catalog)
    const subset = createTransformPreviewSession(base, catalog).preview(['group'], intent, 'global', 'active')
    expect(full.valid).toBe(false)
    expect(subset.valid).toBe(false)
    expect(subset.document).toBeNull()
    expect(subset.blocks).toEqual(full.blocks)
    expect(full.error).toContain('Cell collision')
    expect(subset).toEqual(full)
  })
  it('handles changed selections, empty/missing/duplicate IDs and zero intent', () => {
    const base = document(placed('a'), placed('b', [5, 0, 0]))
    const session = createTransformPreviewSession(base, catalog)
    for (const ids of [['a'], ['b'], ['b', 'a'], [], ['missing'], ['a', 'a']]) for (const intent of [move, { kind: 'move', delta: [0, 0, 0] } as TransformIntent]) {
      expect(session.preview(ids, intent, 'local', 'selection')).toEqual(previewTransform(base, ids, intent, 'local', 'selection', catalog))
    }
  })

  it('rejects invalid bases and newly changed document/catalog inputs at construction', () => {
    const base = document(placed('a', [0, 0, 0], 'minecraft:oak_log'))
    createTransformPreviewSession(base, catalog)
    const changed = structuredClone(base)
    changed.objects[0].cells[0].state.properties.axis = 'bad'
    expect(() => createTransformPreviewSession(changed, catalog)).toThrow()
    const changedCatalog = structuredClone(catalog)
    changedCatalog.find(material => material.id === 'minecraft:oak_log')!.properties.axis = ['x']
    expect(() => createTransformPreviewSession(base, changedCatalog)).toThrow()
    expect(() => createTransformPreviewSession(document(placed('a'), placed('b')), catalog)).toThrow(/collision/)
    const pair = placed('pair', [0, 0, 0], 'minecraft:red_bed')
    pair.cells.pop(); pair.kind = 'block'
    expect(() => createTransformPreviewSession(document(pair), catalog)).toThrow()
  })

  it('reuses one proof across a deterministic mixed-scene selection and intent matrix', () => {
    const group: EditorObject = { id: 'group', name: 'Nested group', kind: 'group', cells: [], children: [placed('group-stone', [-4, 0, -4]), placed('group-log', [-3, 0, -4], 'minecraft:oak_log')], pivot2: [-6, 1, -7], orientation: 0 }
    const component: EditorObject = { id: 'component', name: 'Independent copy', kind: 'component', componentId: 'source-library-asset', cells: [], children: [placed('copy-stone', [0, 0, -4]), placed('copy-log', [0, 1, -4], 'minecraft:oak_log')], pivot2: [1, 2, -7], orientation: 1 }
    const base = document(group, component, placed('bed', [4, 0, -4], 'minecraft:red_bed'), placed('door', [8, 0, -4], 'minecraft:oak_door'), placed('log', [-4, 0, 0], 'minecraft:oak_log'))
    base.id = 'mixed-scene'; base.name = 'Mixed immutable base'
    base.entities = [{ id: 'pig', type: 'minecraft:pig', position: [0.5, 0, 2.5], yaw: 35 }]
    const before = structuredClone(base)
    const session = createTransformPreviewSession(base, catalog)
    const selections = [['group'], ['component', 'bed'], ['door', 'log'], ['log', 'component', 'group'], base.objects.map(root => root.id)]
    const requests: { intent: TransformIntent; space: CoordinateSpace; pivot: PivotMode }[] = [
      ...([[0, 0, 0], [4, 0, 0], [-5, 0, 3], [0, -2, -4], [0, 0, 4], [1, 1, -1]] as Vec3[]).map((delta, index) => ({ intent: { kind: 'move' as const, delta }, space: index % 2 ? 'local' as const : 'global' as const, pivot: 'active' as const })),
      ...(['active', 'selection', 'individual'] as const).flatMap(pivot => [1, 2, -1].map(turns => ({ intent: { kind: 'rotate' as const, turns }, space: 'global' as const, pivot }))),
    ]
    let accepted = 0, rejected = 0
    for (const ids of selections) for (const { intent, space, pivot } of requests) {
      const actual = session.preview(ids, intent, space, pivot)
      expect(actual).toEqual(previewTransform(base, ids, intent, space, pivot, catalog))
      if (actual.document) {
        accepted++
        expect(actual.document.entities).toBe(base.entities)
        expect(actual.document.target).toBe(base.target)
        expect(actual.document.id).toBe(base.id)
        expect(actual.document.name).toBe(base.name)
        expect(actual.document.workspace).toBe(base.workspace)
        expect(actual.document.objects.find(root => root.id === 'component')!.componentId).toBe(component.componentId)
        for (const root of base.objects) if (!ids.includes(root.id)) expect(actual.document.objects.find(next => next.id === root.id)).toBe(root)
      } else rejected++
    }
    expect(accepted).toBeGreaterThan(0)
    expect(rejected).toBeGreaterThan(0)
    expect(selections.length * requests.length).toBe(75)
    expect(base).toEqual(before)
  })

  it('rejects an invalid unselected root before establishing a preview proof', () => {
    const base = document(placed('selected'), placed('unselected', [4, 0, 0], 'minecraft:oak_log'))
    base.objects[1].cells[0].state.properties.axis = 'invalid'
    expect(() => createTransformPreviewSession(base, catalog)).toThrow(/axis/)
  })
  it('validates base once, skips zero revalidation and validates one changed-root batch', () => {
    const release = enableMeasurementPhases()
    try {
      const read = () => (globalThis as typeof globalThis & { __blockstagePhaseRead: () => { events: MeasurementPhase[] } }).__blockstagePhaseRead().events.filter(event => event.name === 'validation.total').length
      const base = document(placed('a'), placed('b', [10, 0, 0]))
      const session = createTransformPreviewSession(base, catalog)
      expect(read()).toBe(1)
      session.preview(['a'], { kind: 'move', delta: [0, 0, 0] }, 'global', 'active')
      expect(read()).toBe(1)
      session.preview(['a', 'b'], move, 'global', 'active')
      expect(read()).toBe(2)
      // Whole-scene selection uses the same bounded batch validation.
      expect(session.preview(['a', 'b'], move, 'global', 'selection').valid).toBe(true)
      expect(read()).toBe(3)
    } finally { release() }
  })
})
