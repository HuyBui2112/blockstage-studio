import { describe, expect, it } from 'vitest'
import type { Block } from '../core/schema'
import type { ComponentAsset, EditorObject } from './model'
import { indexComponentCatalogue, queryComponentCatalogue } from './component-catalogue'

const cell = (name: string, x = 0): Block => ({ pos: [x, 0, 0], state: { name, properties: {} } })
const object = (id: string, cells: Block[], children: EditorObject[] = []): EditorObject => ({ id, name: id, kind: children.length ? 'group' : cells.length > 1 ? 'multiblock' : 'block', cells, children, pivot2: [0, 0, 0], orientation: 0 })
const asset = (id: string, name: string, objects = [object('stone', [cell('minecraft:stone')])]): ComponentAsset => ({ schemaVersion: 1, id, name, objects, pivot2: [0, 0, 0], size: [1, 1, 1], orientation: 0 })
const ids = (entries: ReturnType<typeof indexComponentCatalogue>) => entries.map(entry => entry.asset.id)

describe('component catalogue', () => {
  it('matches Vietnamese accents, decomposed marks and crossed d without requiring resources', () => {
    const entries = indexComponentCatalogue([asset('one', 'Đèn Cửa Sổ'), asset('two', 'Mái gỗ')])
    expect(ids(queryComponentCatalogue(entries, 'DEN cua so', 'name'))).toEqual(['one'])
    expect(ids(queryComponentCatalogue(entries, 'đe\u0300n', 'name'))).toEqual(['one'])
    expect(ids(queryComponentCatalogue(entries, 'mai GO', 'name'))).toEqual(['two'])
  })

  it('requires every whitespace token and matches stored block IDs across the tree', () => {
    const entries = indexComponentCatalogue([asset('one', 'Window', [object('wood', [cell('minecraft:oak_planks')]), object('glass', [cell('minecraft:glass', 1)])]), asset('two', 'Window')])
    expect(ids(queryComponentCatalogue(entries, ' window\tOAK_PLANKS\n glass ', 'name'))).toEqual(['one'])
    expect(queryComponentCatalogue(entries, 'window missing', 'name')).toEqual([])
  })

  it('counts each nested stored cell including pair parts and explicit air, deduplicating IDs', () => {
    const nested = asset('one', 'Pair', [object('outer', [], [object('inner', [], [object('pair', [cell('minecraft:red_bed'), cell('minecraft:red_bed', 1)])]), object('air', [cell('minecraft:air', 2)])])])
    const [entry] = indexComponentCatalogue([nested])
    expect(entry.cells).toBe(3)
    expect(entry.blockIds).toEqual(['minecraft:air', 'minecraft:red_bed'])
    expect(entry.asset).toBe(nested)
  })

  it('sorts deterministically with name and ID tie breakers for either cell order', () => {
    const entries = indexComponentCatalogue([asset('z', 'Same'), asset('b', 'Beta'), asset('a', 'Same'), asset('large', 'Alpha', [object('pair', [cell('minecraft:stone'), cell('minecraft:stone', 1)])])])
    expect(ids(queryComponentCatalogue(entries, '', 'name'))).toEqual(['large', 'b', 'a', 'z'])
    expect(ids(queryComponentCatalogue(entries, '', 'cells-asc'))).toEqual(['b', 'a', 'z', 'large'])
    expect(ids(queryComponentCatalogue(entries, '', 'cells-desc'))).toEqual(['large', 'b', 'a', 'z'])
    expect(ids(queryComponentCatalogue([...entries].reverse(), '', 'cells-asc'))).toEqual(['b', 'a', 'z', 'large'])
  })

  it('does not mutate assets, input order or entries, and handles empty catalogues/queries', () => {
    const assets = [asset('z', 'Zulu'), asset('a', 'Alpha')]
    const before = structuredClone(assets)
    const entries = indexComponentCatalogue(assets)
    const entryOrder = [...entries]
    expect(ids(queryComponentCatalogue(entries, ' \t\n', 'name'))).toEqual(['a', 'z'])
    expect(assets).toEqual(before)
    expect(entries).toEqual(entryOrder)
    expect(queryComponentCatalogue(entries, '', 'name')[0]).toBe(entries[1])
    expect(queryComponentCatalogue(indexComponentCatalogue([]), '', 'name')).toEqual([])
  })
})
