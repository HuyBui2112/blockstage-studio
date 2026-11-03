import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS } from '../src/core/catalog.ts'
import { editorDocumentSchema, validateDocument } from '../src/editor/model.ts'
import { createPerformanceFixture, PERFORMANCE_FIXTURE_KINDS, PERFORMANCE_FIXTURE_SIZES } from './performance-fixtures.mjs'

const catalog = [...DEMO_MATERIALS,
  { id: 'minecraft:white_stained_glass', properties: {}, defaults: {} },
  { id: 'minecraft:red_bed', properties: { facing: ['north', 'east', 'south', 'west'], part: ['foot', 'head'], occupied: ['false', 'true'] }, defaults: {} },
  { id: 'minecraft:oak_door', properties: { facing: ['north', 'east', 'south', 'west'], half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'], powered: ['false', 'true'] }, defaults: {} },
]
function inspect(document) {
  const objects = [], cells = []
  let depth = 0
  const visit = (object, level) => {
    objects.push(object)
    cells.push(...object.cells)
    depth = Math.max(depth, level)
    for (const child of object.children) visit(child, level + 1)
  }
  for (const root of document.objects) visit(root, 1)
  return { objects, cells, depth }
}

describe('P01 deterministic synthetic scenes', () => {
  it('keeps the p01-v1 fixture identity stable across harness changes', () => {
    expect(createPerformanceFixture({ cells: 3, kind: 'pairs', seed: 42 }).meta.documentSha256).toBe('345878806698a960047d855a78c286a2c434605428a960602512575ceb3b7c90')
  })

  it.each(PERFORMANCE_FIXTURE_KINDS)('%s is an asset-independent exact-count valid v2 document', kind => {
    const { document, meta } = createPerformanceFixture({ cells: 1000, kind, seed: 42 })
    expect(editorDocumentSchema.safeParse(document).success).toBe(true)
    expect(() => validateDocument(document, catalog)).not.toThrow()
    const actual = inspect(document)
    expect(actual.cells).toHaveLength(1000)
    expect(actual.objects).toHaveLength(meta.objectCount)
    expect(actual.depth).toBe(meta.maxDepth)
    expect(new Set(actual.cells.map(cell => cell.pos.join(','))).size).toBe(1000)
    expect(meta.occupiedCells).toBe(1000)
    expect(meta.documentSha256).toBe(createHash('sha256').update(JSON.stringify(document)).digest('hex'))
    expect(meta.documentBytes).toBe(Buffer.byteLength(JSON.stringify(document)))
    expect(document.target).toEqual({ gameVersion: '26.2', dataVersion: 4903 })
  })

  it.each(PERFORMANCE_FIXTURE_KINDS)('%s is reproducible and seed changes occupied layout', kind => {
    const first = createPerformanceFixture({ cells: 129, kind, seed: 17 })
    expect(createPerformanceFixture({ cells: 129, kind, seed: 17 })).toEqual(first)
    const second = createPerformanceFixture({ cells: 129, kind, seed: 18 })
    // Compare geometry itself, so merely changing IDs/name/hash cannot pass.
    expect(inspect(first.document).cells.map(cell => cell.pos)).not.toEqual(inspect(second.document).cells.map(cell => cell.pos))
    expect(second.meta.documentSha256).not.toBe(first.meta.documentSha256)
  })

  it.each([['dense', 10000], ['dense', 100000], ['pairs', 100000], ['component', 100000]])('%s supports %i cells within the actual schema budgets', (kind, cells) => {
    const fixture = createPerformanceFixture({ cells, kind, seed: 0xffffffff })
    expect(editorDocumentSchema.safeParse(fixture.document).success).toBe(true)
    const actual = inspect(fixture.document)
    expect(actual.cells).toHaveLength(cells)
    expect(actual.objects.length).toBeLessThanOrEqual(100000)
    expect(actual.depth).toBeLessThanOrEqual(16)
    expect(fixture.meta.maxDepth).toBe(actual.depth)
    expect(fixture.meta.occupiedCells).toBe(cells)
  }, 20000)

  it.each([1, 2, 3, 999, 1000, 1001])('keeps complete non-overlapping pairs at an exact %i-cell size', cells => {
    const fixture = createPerformanceFixture({ cells, kind: 'pairs', seed: 4 })
    const actual = inspect(fixture.document)
    expect(actual.cells).toHaveLength(cells)
    expect(new Set(actual.cells.map(cell => cell.pos.join(','))).size).toBe(cells)
    expect(fixture.meta.pairCount).toBe(Math.floor(cells / 2))
    expect(fixture.meta.singleCellRemainder).toBe(cells % 2)
    for (const root of fixture.document.objects) {
      if (root.kind === 'block') { expect(root.cells[0].state.name).toBe('minecraft:stone'); continue }
      const [first, second] = root.cells
      expect(root.cells).toHaveLength(2)
      expect(second.state.name).toBe(first.state.name)
      if (first.state.name === 'minecraft:oak_door') {
        expect(first.state.properties.half).toBe('lower')
        expect(second.state.properties.half).toBe('upper')
        expect(second.pos).toEqual([first.pos[0], first.pos[1] + 1, first.pos[2]])
      } else {
        expect(first.state.name).toBe('minecraft:red_bed')
        expect(first.state.properties.part).toBe('foot')
        expect(second.state.properties.part).toBe('head')
        expect(second.pos).toEqual([first.pos[0] + 1, first.pos[1], first.pos[2]])
      }
    }
    expect(() => validateDocument(fixture.document, catalog)).not.toThrow()
  })

  it('covers negative chunks, material/state variety, nested independent copies and bounded static entities', () => {
    const sparse = createPerformanceFixture({ cells: 1000, kind: 'sparse', seed: 1 })
    expect(sparse.meta.bounds.min.every(value => value < 0)).toBe(true)
    expect(sparse.meta.chunkCount).toBeGreaterThan(100)
    expect(sparse.meta.chunkCount).toBe(new Set(inspect(sparse.document).cells.map(cell => cell.pos.map(value => Math.floor(value / 16)).join(','))).size)
    const mixed = inspect(createPerformanceFixture({ cells: 1000, kind: 'mixed', seed: 1 }).document).cells
    expect(new Set(mixed.map(cell => cell.state.name)).size).toBe(6)
    expect(new Set(mixed.filter(cell => cell.state.name === 'minecraft:oak_log').map(cell => cell.state.properties.axis))).toEqual(new Set(['x', 'y', 'z']))
    const component = inspect(createPerformanceFixture({ cells: 1000, kind: 'component' }).document)
    expect(component.depth).toBeGreaterThan(2)
    expect(component.objects.some(object => object.kind === 'group')).toBe(true)
    expect(component.objects.filter(object => object.kind === 'component').every(object => object.componentId === 'p01-independent-copy')).toBe(true)
    const entity = createPerformanceFixture({ cells: 100000, kind: 'entity' })
    expect(entity.document.entities).toHaveLength(1000)
    expect(new Set(entity.document.entities.map(value => value.id)).size).toBe(1000)
    expect(entity.document.entities.every(value => value.type === 'minecraft:pig' && value.position.every(Number.isFinite) && Number.isFinite(value.yaw))).toBe(true)
  })

  it.each(PERFORMANCE_FIXTURE_KINDS)('%s command targets move one/all whole roots to free bounded destinations', kind => {
    const { document, meta } = createPerformanceFixture({ cells: 1000, kind })
    const occupied = new Set(inspect(document).cells.map(cell => cell.pos.join(',')))
    expect(meta.commands.moveAll.selection).toEqual(document.objects.map(root => root.id))
    expect(meta.commands.moveRoot.selection).toEqual([document.objects[0].id])
    for (const command of Object.values(meta.commands)) {
      const selected = new Set(command.selection)
      const selectedCells = inspect({ objects: document.objects.filter(root => selected.has(root.id)) }).cells
      for (const cell of selectedCells) {
        const destination = cell.pos.map((value, axis) => value + command.delta[axis])
        expect(occupied.has(destination.join(','))).toBe(false)
        expect(destination[1]).toBeLessThanOrEqual(2048)
      }
    }
  })

  it('rejects invalid counts/seeds/kinds before touching expandable fixture data', () => {
    for (const cells of [0, -1, 1.5, NaN, Infinity, 100001, Number.MAX_SAFE_INTEGER, '1000']) {
      expect(() => createPerformanceFixture({ cells })).toThrow('Fixture cells must be an integer from 1 to 100000')
    }
    for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000, '1']) expect(() => createPerformanceFixture({ seed })).toThrow(RangeError)
    expect(() => createPerformanceFixture({ kind: 'unknown' })).toThrow(RangeError)
    expect(PERFORMANCE_FIXTURE_SIZES).toEqual([1000, 10000, 100000])
  })
})
