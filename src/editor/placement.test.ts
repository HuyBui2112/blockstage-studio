import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, type Material } from '../core/catalog'
import type { BlockState } from '../core/schema'
import { createPlacedObject, logicalCellGroups, rewriteLogicalState, validateLogicalObject } from './placement'

const facing = ['north', 'east', 'south', 'west']
const material = (id: string, properties: Record<string, string[]>, defaults: Record<string, string>): Material => ({ id: `minecraft:${id}`, label: id, family: id, color: '#aaa', properties, defaults })
const catalog = [...DEMO_MATERIALS,
  material('red_bed', { facing, part: ['foot', 'head'], occupied: ['false', 'true'] }, { facing: 'north', part: 'foot', occupied: 'false' }),
  material('oak_door', { facing, half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'], powered: ['false', 'true'] }, { facing: 'north', half: 'lower', hinge: 'left', open: 'false', powered: 'false' }),
  ...['sunflower', 'tall_seagrass'].map(id => material(id, { half: ['lower', 'upper'] }, { half: 'lower' })),
  material('small_dripleaf', { facing, half: ['lower', 'upper'], waterlogged: ['false', 'true'] }, { facing: 'north', half: 'lower', waterlogged: 'false' }),
  material('pitcher_crop', { age: ['0', '1', '2', '3', '4'], half: ['lower', 'upper'] }, { age: '0', half: 'lower' }),
]
const state = (id: string, properties: Record<string, string> = {}): BlockState => ({ name: `minecraft:${id}`, properties: { ...catalog.find(m => m.id === `minecraft:${id}`)!.defaults, ...properties } })

describe('logical design placement', () => {
  it.each([['north', [0, 0, -1]], ['east', [1, 0, 0]], ['south', [0, 0, 1]], ['west', [-1, 0, 0]]] as const)('places both bed cells facing %s and normalizes selected head', (facing, offset) => {
    const source = state('red_bed', { part: 'head', facing }), snapshot = structuredClone(source)
    const object = createPlacedObject(source, [5, 8, 11], catalog)
    expect(object.kind).toBe('multiblock'); expect(object.pivot2).toEqual([11, 17, 23])
    expect(object.cells.map(c => c.pos)).toEqual([[5, 8, 11], [5 + offset[0], 8, 11 + offset[2]]])
    expect(object.cells.map(c => c.state.properties.part)).toEqual(['foot', 'head'])
    expect(source).toEqual(snapshot)
  })

  it.each(['oak_door', 'sunflower', 'tall_seagrass', 'small_dripleaf'])('places a complete vertical %s from an upper selection', id => {
    const object = createPlacedObject(state(id, { half: 'upper' }), [0, 1, 0], catalog)
    expect(object.cells.map(c => c.pos)).toEqual([[0, 1, 0], [0, 2, 0]])
    expect(object.cells.map(c => c.state.properties.half)).toEqual(['lower', 'upper'])
    expect(() => validateLogicalObject(object, catalog)).not.toThrow()
  })

  it('keeps a slab one integer cell regardless of visible half height', () => {
    const object = createPlacedObject(state('stone_brick_slab'), [3, 2, -1], catalog)
    expect(object.kind).toBe('block'); expect(object.cells).toHaveLength(1)
    expect(() => createPlacedObject(state('stone'), [.5, 0, 0], catalog)).toThrow()
    expect(() => createPlacedObject(state('oak_door'), [0, 2048, 0], catalog)).toThrow()
  })

  it('synchronizes door hinge/open and rejects editing one half', () => {
    const original = createPlacedObject(state('oak_door'), [0, 0, 0], catalog)
    const opened = rewriteLogicalState(original, 'open', 'true', catalog)
    const changed = rewriteLogicalState(opened, 'hinge', 'right', catalog)
    expect(changed.cells.map(c => [c.state.properties.open, c.state.properties.hinge])).toEqual([['true', 'right'], ['true', 'right']])
    expect(original.cells[0].state.properties.open).toBe('false')
    expect(() => rewriteLogicalState(original, 'half', 'upper', catalog)).toThrow('whole logical object')
    expect(() => rewriteLogicalState(original, 'open', 'invalid', catalog)).toThrow()
  })

  it('changes bed facing by rebuilding the head around the same foot', () => {
    const object = createPlacedObject(state('red_bed'), [3, 2, 7], catalog)
    const changed = rewriteLogicalState(object, 'facing', 'east', catalog)
    expect(changed.cells.map(c => c.pos)).toEqual([[3, 2, 7], [4, 2, 7]])
    expect(changed.cells.every(c => c.state.properties.facing === 'east')).toBe(true)
    expect(object.cells[1].pos).toEqual([3, 2, 6])
  })

  it('preserves independent waterlogging in imported small dripleaf halves', () => {
    const object = createPlacedObject(state('small_dripleaf'), [0, 0, 0], catalog)
    object.cells[0].state.properties.waterlogged = 'true'
    expect(() => validateLogicalObject(object, catalog)).not.toThrow()
    expect(logicalCellGroups(object.cells)).toHaveLength(1)
    const changed = rewriteLogicalState(object, 'facing', 'east', catalog)
    expect(changed.cells.map(c => c.state.properties.waterlogged)).toEqual(['true', 'false'])
  })

  it('handles the pitcher crop age boundary atomically', () => {
    const young = createPlacedObject(state('pitcher_crop', { half: 'upper', age: '2' }), [0, 0, 0], catalog)
    expect(young.cells).toHaveLength(1); expect(young.cells[0].state.properties.half).toBe('lower')
    const grown = rewriteLogicalState(young, 'age', '3', catalog)
    expect(grown.kind).toBe('multiblock'); expect(grown.cells).toHaveLength(2)
    const reduced = rewriteLogicalState(grown, 'age', '1', catalog)
    expect(reduced.kind).toBe('block'); expect(reduced.cells).toHaveLength(1)
  })

  it('rejects incomplete or mismatched pairs, including in flat component copies', () => {
    const object = createPlacedObject(state('red_bed'), [0, 0, 0], catalog)
    expect(() => validateLogicalObject({ ...object, cells: [object.cells[0]] }, catalog)).toThrow('Incomplete')
    const broken = structuredClone(object); broken.cells[1].state.properties.occupied = 'true'
    expect(() => validateLogicalObject({ ...broken, kind: 'component' }, catalog)).toThrow('Mismatched')
  })

  it('coalesces explicit legacy cells independent of order and rejects orphan halves', () => {
    const object = createPlacedObject(state('oak_door'), [0, 0, 0], catalog)
    const groups = logicalCellGroups([...object.cells].reverse())
    expect(groups).toEqual([object.cells]); expect(groups[0][0]).not.toBe(object.cells[0])
    expect(() => logicalCellGroups([object.cells[1]])).toThrow('Incomplete')
  })

  it('does not infer paired families from tags or names', () => {
    const custom = material('pretend_door', { half: ['lower', 'upper'] }, { half: 'lower' })
    custom.tags = ['minecraft:doors']
    expect(() => createPlacedObject({ name: custom.id, properties: custom.defaults }, [0, 0, 0], [...catalog, custom])).toThrow('No verified')
  })
})
