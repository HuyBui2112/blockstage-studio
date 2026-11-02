import { describe, expect, it } from 'vitest'
import { countPlacedBlocks, placedBlockCountsCsv, placedBlockCountsJson } from './material-counts'
import { newEditorDocument, type EditorObject } from './model'

function block(id: string, x: number, name = 'minecraft:stone', properties: Record<string, string> = {}): EditorObject {
  return { id, name: 'Block', kind: 'block', cells: [{ pos: [x, 0, 0], state: { name, properties } }], children: [], pivot2: [x * 2 + 1, 1, 1], orientation: 0 }
}
function group(id: string, children: EditorObject[], kind: 'group' | 'component' = 'group'): EditorObject {
  return { id, name: 'Group', kind, cells: [], children, pivot2: [1, 1, 1], orientation: 0 }
}
describe('placed block counts', () => {
  it('counts pairs as two occupied cells and nested independent component copies without mutation', () => {
    const pair = { ...block('door', 0, 'minecraft:oak_door', { half: 'lower' }), kind: 'multiblock' as const }
    pair.cells.push({ pos: [0, 1, 0], state: { name: 'minecraft:oak_door', properties: { half: 'upper' } } })
    const document = { ...newEditorDocument(), objects: [group('g', [pair, group('copy1', [block('a', 1)], 'component')]), group('copy2', [block('b', 2)], 'component')] }
    const before = structuredClone(document), report = countPlacedBlocks(document)
    expect(report.occupiedCells).toBe(4)
    expect(report.byId).toEqual([{ id: 'minecraft:oak_door', cells: 2, air: false }, { id: 'minecraft:stone', cells: 2, air: false }])
    expect(document).toEqual(before)
    expect(countPlacedBlocks(document, { kind: 'selection', objectIds: ['g', 'g'] }).occupiedCells).toBe(3)
    expect(() => countPlacedBlocks(document, { kind: 'selection', objectIds: ['g', 'a'] })).toThrow(/top-level/)
  })
  it('separates all explicit vanilla air IDs and excludes omitted cells and entities', () => {
    const document = { ...newEditorDocument(), objects: [block('a', 0, 'minecraft:air'), block('b', 2, 'minecraft:cave_air'), block('c', 4, 'minecraft:void_air'), block('d', 6)] }
    const report = countPlacedBlocks(document)
    expect([report.occupiedCells, report.nonAirCells, report.airCells]).toEqual([4, 1, 3])
    expect(countPlacedBlocks(document, { kind: 'selection', objectIds: [] }).occupiedCells).toBe(0)
  })
  it('preserves unrecognized string states and canonicalizes property and root order', () => {
    const a = block('a', 0, 'custom:block', { z: 'unknown', a: 'true' }), b = block('b', 1, 'custom:block', { a: 'true', z: 'unknown' })
    const document = { ...newEditorDocument(), objects: [a, b] }
    const report = countPlacedBlocks(document)
    expect(report.byState).toEqual([{ id: 'custom:block', properties: { a: 'true', z: 'unknown' }, state: 'custom:block[a=true,z=unknown]', cells: 2, air: false }])
    expect(placedBlockCountsJson(report)).toBe(placedBlockCountsJson(countPlacedBlocks({ ...document, objects: [b, a] })))
  })
  it('exports deterministic JSON and escapes CSV commas, quotes and newlines', () => {
    const document = { ...newEditorDocument(), name: 'Room, "A"\nCounts', objects: [block('a', 0, 'custom:block', { z: 'north', a: 'true' })] }
    const report = countPlacedBlocks(document), csv = placedBlockCountsCsv(report)
    expect(csv).toContain('"Room, ""A""\nCounts"')
    expect(csv).toContain('"custom:block[a=true,z=north]",1,false\r\n')
    expect(JSON.parse(placedBlockCountsJson(report))).toMatchObject({ format: 'blockstage-placed-block-counts', version: 1, occupiedCells: 1 })
  })
  it('rejects invalid/cyclic structures before traversal instead of dropping content', () => {
    const cyclic = group('g', []); cyclic.children.push(cyclic)
    expect(() => countPlacedBlocks({ ...newEditorDocument(), objects: [cyclic] })).toThrow()
    expect(() => countPlacedBlocks({ ...newEditorDocument(), objects: [block('a', 0), block('b', 0)] })).toThrow(/collision/)
  })
})
