import { gunzipSync, strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { Block, Vec3 } from '../core/schema'
import { newEditorDocument, type EditorDocument, type EditorObject } from '../editor/model'
import { componentFromSelection, instantiateComponent, rotateObjects } from '../editor/operations'
import { createPlacedObject } from '../editor/placement'
import { exportEditorDatapack, exportEditorStructure, preflightEditorExport } from './editor-export'

// Synthetic finite registry fixtures; no game assets or extracted profiles.
const material = (id: string, properties: Record<string, string[]> = {}, defaults: Record<string, string> = {}, hasBlockEntity = false): Material => ({ id: `minecraft:${id}`, label: id, family: id, color: '#888888', properties, defaults, hasBlockEntity, source: 'game-profile' })
const facing = ['north', 'east', 'south', 'west']
const catalog: Material[] = [
  ...DEMO_MATERIALS,
  material('red_bed', { facing, part: ['foot', 'head'], occupied: ['false', 'true'] }, { facing: 'north', part: 'foot', occupied: 'false' }),
  material('oak_door', { facing, half: ['lower', 'upper'], hinge: ['left', 'right'], open: ['false', 'true'], powered: ['false', 'true'] }, { facing: 'north', half: 'lower', hinge: 'right', open: 'false', powered: 'true' }),
  material('sunflower', { half: ['lower', 'upper'] }, { half: 'lower' }),
  material('air'), material('cave_air'), material('void_air'), material('chest', {}, {}, true), material('profile_stone'),
]
function document(objects: EditorObject[] = []): EditorDocument { return { ...newEditorDocument(), name: 'Export fixture', objects } }
function placed(id = 'stone', pos: Vec3 = [0, 0, 0]): EditorObject { return createPlacedObject(defaultState(`minecraft:${id}`, catalog), pos, catalog) }
function container(kind: 'group' | 'component', children: EditorObject[]): EditorObject {
  return { id: crypto.randomUUID(), name: kind, kind, cells: [], children, orientation: 3, pivot2: [17, 9, 5], ...(kind === 'component' ? { componentId: 'source-library-id' } : {}) }
}
type Decoded = {
  DataVersion: number; size: Vec3; palette: { Name: string; Properties?: Record<string, string> }[]
  blocks: { pos: Vec3; state: number }[]
  entities: { pos: number[]; blockPos: Vec3; nbt: { id: string; Pos: number[]; Rotation: number[] } }[]
}
// Independent big-endian NBT reader verifies the actual emitted bytes and full consumption.
function decode(compressed: Uint8Array): Decoded {
  expect([...compressed.slice(0, 2)]).toEqual([31, 139])
  const bytes = gunzipSync(compressed), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let cursor = 0
  const u8 = () => view.getUint8(cursor++)
  const numeric = (length: number, read: (offset: number) => number) => { const value = read(cursor); cursor += length; return value }
  const i32 = () => numeric(4, offset => view.getInt32(offset))
  const text = () => { const length = numeric(2, offset => view.getUint16(offset)); const value = strFromU8(bytes.slice(cursor, cursor + length)); cursor += length; return value }
  const payload = (type: number): unknown => {
    if (type === 3) return i32()
    if (type === 5) return numeric(4, offset => view.getFloat32(offset))
    if (type === 6) return numeric(8, offset => view.getFloat64(offset))
    if (type === 8) return text()
    if (type === 9) { const element = u8(), length = i32(); expect(length).toBeGreaterThanOrEqual(0); return Array.from({ length }, () => payload(element)) }
    if (type === 10) { const result: Record<string, unknown> = {}; for (let child = u8(); child; child = u8()) { const name = text(); result[name] = payload(child) }; return result }
    throw new Error(`Unexpected NBT tag ${type}`)
  }
  expect(u8()).toBe(10); expect(text()).toBe('')
  const result = payload(10) as Decoded
  expect(cursor).toBe(bytes.byteLength)
  for (const block of result.blocks) {
    expect(block.state).toBeGreaterThanOrEqual(0); expect(block.state).toBeLessThan(result.palette.length)
    block.pos.forEach((value, axis) => { expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(result.size[axis]) })
  }
  return result
}
function blocks(nbt: Decoded): Block[] {
  return nbt.blocks.map(block => ({ pos: block.pos, state: { name: nbt.palette[block.state].Name, properties: nbt.palette[block.state].Properties ?? {} } })).sort((a, b) => a.pos.join(',').localeCompare(b.pos.join(',')))
}
function reject(doc: EditorDocument, code: string, materials = catalog) {
  const result = preflightEditorExport(doc, materials)
  expect(result.valid).toBe(false)
  expect(result.issues.some(issue => issue.severity === 'error' && issue.code === code)).toBe(true)
  expect(() => exportEditorStructure(doc, materials)).toThrow()
  expect(() => exportEditorDatapack(doc, materials)).toThrow()
}

describe('committed editor document Minecraft export', () => {
  it('exports nested groups, copied components and complete rotated pairs without applying metadata transforms twice', () => {
    const bed = placed('red_bed', [-7, -3, -6])
    const rotatedBed = rotateObjects(document([bed]), [bed.id], 1, 'active', catalog).objects[0]
    const door = placed('oak_door', [-4, -3, -5]), plant = placed('sunflower', [-2, -3, -4]), log = placed('oak_log', [-5, -3, -7])
    const doc = document([container('group', [rotatedBed, door, container('component', [plant, log])])])
    const before = structuredClone(doc), preflight = preflightEditorExport(doc, catalog), exported = exportEditorStructure(doc, catalog)
    expect(preflight).toMatchObject({ valid: true, origin: [-7, -3, -7], size: [6, 2, 4], blockCount: 7, entityCount: 0 })
    expect(preflight.issues.every(issue => issue.severity === 'warning')).toBe(true)
    expect(exported.origin).toEqual(preflight.origin); expect(exported.count).toBe(7)
    const nbt = decode(exported.bytes)
    expect(nbt.DataVersion).toBe(4903); expect(nbt.size).toEqual([6, 2, 4]); expect(nbt.entities).toEqual([])
    const expected: Block[] = [
      { pos: [0, 0, 1], state: { name: 'minecraft:red_bed', properties: { facing: 'east', part: 'foot', occupied: 'false' } } },
      { pos: [1, 0, 1], state: { name: 'minecraft:red_bed', properties: { facing: 'east', part: 'head', occupied: 'false' } } },
      { pos: [3, 0, 2], state: { name: 'minecraft:oak_door', properties: { facing: 'north', half: 'lower', hinge: 'right', open: 'false', powered: 'true' } } },
      { pos: [3, 1, 2], state: { name: 'minecraft:oak_door', properties: { facing: 'north', half: 'upper', hinge: 'right', open: 'false', powered: 'true' } } },
      { pos: [5, 0, 3], state: { name: 'minecraft:sunflower', properties: { half: 'lower' } } },
      { pos: [5, 1, 3], state: { name: 'minecraft:sunflower', properties: { half: 'upper' } } },
      { pos: [2, 0, 0], state: { name: 'minecraft:oak_log', properties: { axis: 'y' } } },
    ]
    expect(blocks(nbt)).toEqual(expected.sort((a, b) => a.pos.join(',').localeCompare(b.pos.join(','))))
    expect(doc).toEqual(before)
  })

  it('exports a real library component copy using its stored cells', () => {
    const bed = placed('red_bed', [-3, 5, -6]), source = document([bed])
    const asset = componentFromSelection(source, [bed.id], 'Bed component')
    const instance = instantiateComponent(asset, [10, 2, 12]), doc = document([instance]), before = structuredClone(asset)
    const result = exportEditorStructure(doc, catalog), nbt = decode(result.bytes)
    expect(result.origin).toEqual([10, 2, 12]); expect(result.count).toBe(2)
    expect(blocks(nbt).map(block => [block.pos, block.state.properties.part])).toEqual([[[0, 0, 0], 'head'], [[0, 0, 1], 'foot']])
    expect(asset).toEqual(before)
  })

  it('reports bounded support diagnostics as located warnings without blocking export or mutating cells', () => {
    const floatingDoor = placed('oak_door', [3, 2, 4]), floatingBed = placed('red_bed', [10, 2, 4])
    const doc = document([container('group', [floatingDoor, floatingBed])]), before = structuredClone(doc)
    const result = preflightEditorExport(doc, catalog)
    expect(result.valid).toBe(true)
    expect(result.issues.filter(issue => issue.code === 'missing_support')).toEqual([expect.objectContaining({
      severity: 'warning', objectId: doc.objects[0].id, pos: [3, 2, 4], supportPos: [3, 1, 4],
    })])
    expect(exportEditorStructure(doc, catalog).count).toBe(4)
    expect(doc).toEqual(before)
  })

  it('warns for sunflower on stone but leaves vanilla floating bed pairs alone', () => {
    const doc = document([placed('stone'), placed('sunflower', [0, 1, 0]), placed('red_bed', [4, 1, 0])])
    const result = preflightEditorExport(doc, catalog)
    expect(result.valid).toBe(true)
    expect(result.issues.filter(issue => issue.code === 'invalid_support')).toEqual([expect.objectContaining({ severity: 'warning', pos: [0, 1, 0], supportPos: [0, 0, 0] })])
    expect(result.issues.some(issue => issue.code === 'missing_support')).toBe(false)
    expect(exportEditorStructure(doc, catalog).count).toBe(5)
  })

  it('bounds support warnings independently of export errors', () => {
    const doc = document(Array.from({ length: 150 }, (_, index) => placed('oak_door', [index % 15, 2, Math.floor(index / 15)])))
    const result = preflightEditorExport(doc, catalog)
    expect(result.valid).toBe(true)
    expect(result.issues.filter(issue => issue.code === 'missing_support')).toHaveLength(100)
    expect(result.issues.find(issue => issue.code === 'support_unknown')?.message).toContain('50 additional support diagnostics omitted')
    expect(result.issues.every(issue => issue.severity === 'warning')).toBe(true)
  })

  it('normalizes fractional entity positions together with blocks and preserves yaw', () => {
    const doc = document([placed('stone', [-2, -3, -4])])
    doc.entities = [{ id: 'pig', type: 'minecraft:pig', position: [-2.25, -3.5, -4.25], yaw: 37.5 }]
    const before = structuredClone(doc), result = preflightEditorExport(doc, catalog), nbt = decode(exportEditorStructure(doc, catalog).bytes)
    expect(result).toMatchObject({ valid: true, origin: [-3, -4, -5], size: [2, 2, 2], blockCount: 1, entityCount: 1 })
    expect(nbt.blocks[0].pos).toEqual([1, 1, 1])
    expect(nbt.entities).toEqual([{ pos: [0.75, 0.5, 0.75], blockPos: [0, 0, 0], nbt: { id: 'minecraft:pig', Pos: [0.75, 0.5, 0.75], Rotation: [37.5, 0] } }])
    expect(doc).toEqual(before)
  })

  it('supports a finite allowlisted entity-only scene', () => {
    const doc = document(); doc.entities = [{ id: 'pig', type: 'minecraft:pig', position: [-1.25, 2.5, 4.75], yaw: -90 }]
    const preflight = preflightEditorExport(doc, [])
    expect(preflight).toMatchObject({ valid: true, origin: [-2, 2, 4], size: [1, 1, 1], blockCount: 0, entityCount: 1 })
    const nbt = decode(exportEditorStructure(doc, []).bytes)
    expect(nbt.palette).toEqual([]); expect(nbt.blocks).toEqual([]); expect(nbt.entities[0].pos).toEqual([0.75, 0.5, 0.75])
  })

  it('writes a usable fixed template path, current datapack format and explicit placement limitations', () => {
    const doc = document([placed('stone', [-9, 2, -3])]), before = structuredClone(doc)
    const zip = unzipSync(exportEditorDatapack(doc, catalog))
    expect(Object.keys(zip).sort()).toEqual(['README.txt', 'data/blockstage/structure/build.nbt', 'pack.mcmeta'])
    expect(JSON.parse(strFromU8(zip['pack.mcmeta']))).toEqual({ pack: { description: 'Blockstage: Export fixture', min_format: [107, 1], max_format: [107, 1] } })
    expect(decode(zip['data/blockstage/structure/build.nbt']).blocks).toHaveLength(1)
    const readme = strFromU8(zip['README.txt'])
    for (const text of ['/place template blockstage:build ~ ~ ~', '26.2', '4903', '-9, 2, -3', 'empty cells leave the destination unchanged', 'Explicit air', 'not simulated', 'Fabric/modded']) expect(readme).toContain(text)
    expect(doc).toEqual(before)
  })

  it.each(['air', 'cave_air', 'void_air'])('includes explicit %s cells while leaving sparse gaps out', id => {
    const doc = document([placed('stone'), placed(id, [2, 0, 0])]), result = preflightEditorExport(doc, catalog), nbt = decode(exportEditorStructure(doc, catalog).bytes)
    expect(result.valid).toBe(true); expect(result.issues.map(issue => issue.code)).toContain('explicit_air')
    expect(result.issues.map(issue => issue.code)).toContain('sparse_cells_unchanged')
    expect(nbt.size).toEqual([3, 1, 1]); expect(nbt.blocks.map(block => block.pos)).toEqual([[0, 0, 0], [2, 0, 0]])
    expect(nbt.palette.map(state => state.Name)).toContain(`minecraft:${id}`)
  })

  it('allows built-in finite demo states without assets and requires profile provenance for other blocks', () => {
    const demo = document([placed('oak_log')])
    expect(preflightEditorExport(demo, DEMO_MATERIALS).valid).toBe(true)
    expect(preflightEditorExport(demo, DEMO_MATERIALS).issues.map(issue => issue.code)).toContain('demo_registry')
    expect(decode(exportEditorStructure(demo, DEMO_MATERIALS).bytes).palette[0]).toEqual({ Name: 'minecraft:oak_log', Properties: { axis: 'y' } })
    const ordinary = document([placed('profile_stone')])
    expect(preflightEditorExport(ordinary, catalog).valid).toBe(true)
    reject(ordinary, 'profile_required', catalog.map(entry => entry.id === 'minecraft:profile_stone' ? { ...entry, source: undefined } : entry))
    reject(demo, 'invalid_state', [])
  })

  it('rejects unsupported content instead of silently dropping it', () => {
    reject(document(), 'empty_scene')
    reject(document([placed('chest')]), 'block_entity')
    const unknown = document([placed()]); unknown.objects[0].cells[0].state.name = 'minecraft:unknown_block'
    reject(unknown, 'profile_required')
    const entity = document(); entity.entities = [{ id: 'warden', type: 'minecraft:warden', position: [0, 0, 0], yaw: 0 }]
    reject(entity, 'unsupported_entity')
  })

  it.each([
    { axis: 'sideways' }, {}, { axis: 'y', unknown: 'true' },
  ])('rejects missing, illegal or unknown block properties: %j', properties => {
    const doc = document([placed('oak_log')]); doc.objects[0].cells[0].state.properties = properties as Record<string, string>
    reject(doc, 'invalid_state')
    expect(preflightEditorExport(doc, catalog).issues.find(issue => issue.code === 'invalid_state')?.objectId).toBe(doc.objects[0].id)
  })

  it('does not trust forged demo state metadata without a game profile', () => {
    const doc = document([placed('oak_log')]); doc.objects[0].cells[0].state.properties.axis = 'diagonal'
    const forged = DEMO_MATERIALS.map(entry => entry.id === 'minecraft:oak_log' ? { ...entry, properties: { axis: ['diagonal'] } } : entry)
    reject(doc, 'invalid_state', forged)
  })

  it('bounds large error reports while rejecting every unsupported cell', () => {
    const doc = document(Array.from({ length: 250 }, (_, index) => {
      const object = placed('stone', [index % 16, Math.floor(index / 16), 0])
      object.cells[0].state.name = 'minecraft:unsupported'
      return object
    }))
    const result = preflightEditorExport(doc, catalog)
    expect(result.valid).toBe(false); expect(result.blockCount).toBe(250)
    expect(result.issues.filter(issue => issue.code === 'profile_required')).toHaveLength(100)
    expect(result.issues.find(issue => issue.code === 'additional_errors')?.message).toContain('150 additional export errors')
    expect(() => exportEditorStructure(doc, catalog)).toThrow('unsupported')
  })

  it('requires pairs within their logical leaf and rejects orphaned or mismatched halves', () => {
    const bed = placed('red_bed'), orphan = document([bed]); orphan.objects[0].cells.pop(); orphan.objects[0].kind = 'block'
    reject(orphan, 'logical_pair')
    const whole = placed('red_bed'), mismatch = document([whole]); whole.cells[1].state.properties.occupied = 'true'
    reject(mismatch, 'logical_pair')
    const pair = placed('red_bed'), split = document(pair.cells.map((cell, index) => ({ ...pair, id: `half-${index}`, kind: 'block', cells: [cell] })))
    reject(split, 'logical_pair')
  })

  it('accepts 48 cells across an axis and blocks larger cell or entity bounds', () => {
    const doc = document([placed('stone', [-10, 0, 0]), placed('stone', [37, 0, 0])])
    expect(preflightEditorExport(doc, catalog)).toMatchObject({ valid: true, size: [48, 1, 1] })
    expect(decode(exportEditorStructure(doc, catalog).bytes).size).toEqual([48, 1, 1])
    doc.objects[1].cells[0].pos[0] = 38; reject(doc, 'structure_bounds')
    doc.objects.pop(); doc.entities = [{ id: 'far-pig', type: 'minecraft:pig', position: [38, 0, 0], yaw: 0 }]
    reject(doc, 'structure_bounds')
  })

  it.each([
    ['fractional cell', (doc: EditorDocument) => { doc.objects[0].cells[0].pos[0] = 0.5 }, 'invalid_document'],
    ['NaN cell', (doc: EditorDocument) => { doc.objects[0].cells[0].pos[1] = NaN }, 'invalid_document'],
    ['infinite entity', (doc: EditorDocument) => { doc.entities = [{ id: 'pig', type: 'minecraft:pig', position: [Infinity, 0, 0], yaw: 0 }] }, 'invalid_document'],
    ['NaN yaw', (doc: EditorDocument) => { doc.entities = [{ id: 'pig', type: 'minecraft:pig', position: [0, 0, 0], yaw: NaN }] }, 'invalid_document'],
    ['wrong target version', (doc: EditorDocument) => { Object.assign(doc.target, { gameVersion: '26.1' }) }, 'target_profile'],
    ['wrong data version', (doc: EditorDocument) => { Object.assign(doc.target, { dataVersion: 4902 }) }, 'target_profile'],
    ['unknown block NBT', (doc: EditorDocument) => { Object.assign(doc.objects[0].cells[0], { nbt: { CustomName: 'must not disappear' } }) }, 'invalid_document'],
    ['unknown entity NBT', (doc: EditorDocument) => { doc.entities = [{ id: 'pig', type: 'minecraft:pig', position: [0, 0, 0], yaw: 0 }]; Object.assign(doc.entities[0], { nbt: { NoAI: 1 } }) }, 'invalid_document'],
    ['duplicate cells', (doc: EditorDocument) => { doc.objects.push(placed()) }, 'duplicate_cell'],
    ['duplicate object ids', (doc: EditorDocument) => { const object = placed('stone', [1, 0, 0]); object.id = doc.objects[0].id; doc.objects.push(object) }, 'invalid_document'],
    ['cycle', (doc: EditorDocument) => { const group = container('group', doc.objects); group.children.push(group); doc.objects = [group] }, 'invalid_document'],
  ] as const)('rejects malformed input: %s', (_label, mutate, code) => {
    const doc = document([placed()]); mutate(doc); reject(doc, code)
  })
})
