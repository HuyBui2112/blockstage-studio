import { describe, expect, it } from 'vitest'
import { gunzipSync, strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportDatapack, exportStructure } from './structure'
import { DEMO_MATERIALS, defaultState } from '../core/catalog'
import { newProject } from '../core/seed'
import { parsePack } from './archive'
import { asset, texturePaths } from './resources'
import { gameProfileSchema, profileMaterials } from '../core/profile'

// Independent reader checks tag types, lengths, byte order and complete consumption.
function decode(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let cursor = 0
  const u8 = () => view.getUint8(cursor++)
  const i32 = () => { const n = view.getInt32(cursor); cursor += 4; return n }
  const f32 = () => { const n = view.getFloat32(cursor); cursor += 4; return n }
  const f64 = () => { const n = view.getFloat64(cursor); cursor += 8; return n }
  const text = () => { const length = view.getUint16(cursor); cursor += 2; const s = strFromU8(bytes.slice(cursor, cursor + length)); cursor += length; return s }
  function payload(type: number): unknown {
    if (type === 3) return i32()
    if (type === 5) return f32()
    if (type === 6) return f64()
    if (type === 8) return text()
    if (type === 9) { const element = u8(), length = i32(); return Array.from({ length }, () => payload(element)) }
    if (type === 10) { const result: Record<string, unknown> = {}; for (let t = u8(); t !== 0; t = u8()) { const name = text(); result[name] = payload(t) }; return result }
    throw new Error(`Unexpected tag ${type}`)
  }
  expect(u8()).toBe(10); expect(text()).toBe('')
  const result = payload(10) as { DataVersion: number; size: number[]; palette: { Name: string; Properties?: Record<string, string> }[]; blocks: { pos: number[]; state: number }[]; entities: { pos: number[]; blockPos: number[]; nbt: { id: string; Pos: number[]; Rotation: number[] } }[] }
  expect(cursor).toBe(bytes.length)
  return result
}
describe('Java gzip NBT / datapack', () => {
  it('writes a gzip structure with valid palette and normalized positions', () => {
    const exported = exportStructure(newProject(true), DEMO_MATERIALS)
    expect(Array.from(exported.bytes.slice(0, 2))).toEqual([31, 139])
    const nbt = decode(gunzipSync(exported.bytes))
    expect(nbt.DataVersion).toBe(4903); expect(nbt.size).toEqual([6, 6, 6]); expect(nbt.blocks).toHaveLength(85); expect(nbt.entities).toEqual([])
    expect(nbt.palette.some(s => s.Name === 'minecraft:oak_log' && s.Properties?.axis === 'y')).toBe(true)
    for (const b of nbt.blocks) { expect(b.state).toBeLessThan(nbt.palette.length); b.pos.forEach((v, n) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(nbt.size[n]) }) }
  })
  it('normalizes negative positions without mutating source data', () => {
    const p = newProject(); p.blocks = [{ pos: [-21, -8, -4], state: defaultState('minecraft:oak_log') }]
    const exported = exportStructure(p, DEMO_MATERIALS), nbt = decode(gunzipSync(exported.bytes))
    expect(exported.origin).toEqual([-21, -8, -4]); expect(nbt.blocks[0].pos).toEqual([0, 0, 0]); expect(p.blocks[0].pos).toEqual([-21, -8, -4])
  })
  it('writes 26.2 pack metadata and singular structure directory', () => {
    const zip = unzipSync(exportDatapack(newProject(true), DEMO_MATERIALS))
    expect(JSON.parse(strFromU8(zip['pack.mcmeta']))).toMatchObject({ pack: { min_format: [107, 1], max_format: [107, 1] } })
    expect(decode(gunzipSync(zip['data/blockstage/structure/build.nbt'])).DataVersion).toBe(4903)
    expect(strFromU8(zip['README.txt'])).toContain('/place template blockstage:build')
  })
  it('rejects empty, oversized, colliding and invalid-state exports', () => {
    const p = newProject(); expect(() => exportStructure(p, DEMO_MATERIALS)).toThrow('chưa có')
    p.blocks = [{ pos: [0, 0, 0], state: defaultState('minecraft:stone') }, { pos: [48, 0, 0], state: defaultState('minecraft:stone') }]
    expect(() => exportStructure(p, DEMO_MATERIALS)).toThrow('48')
    p.blocks[1].pos = [0, 0, 0]; expect(() => exportStructure(p, DEMO_MATERIALS)).toThrow('Trùng')
    p.blocks = [{ pos: [0, 0, 0], state: { name: 'minecraft:oak_log', properties: { axis: 'invalid' } } }]
    expect(() => exportStructure(p, DEMO_MATERIALS)).toThrow()
  })
  it('fails explicitly for blocks without a validated placement/export adapter', () => {
    const p = newProject(); p.blocks = [{ pos: [0, 0, 0], state: { name: 'minecraft:chest', properties: {} } }]
    expect(() => exportStructure(p, DEMO_MATERIALS)).toThrow('adapter')
  })
  it('writes normalized fractional entity coordinates, block position, yaw and float rotation', () => {
    const p = newProject(); p.entities = [{ id: 'pig-1', type: 'minecraft:pig', position: [-2.25, -3.5, -0.25], yaw: 37.5 }]
    const nbt = decode(gunzipSync(exportStructure(p, DEMO_MATERIALS).bytes))
    expect(nbt.size).toEqual([1, 1, 1])
    expect(nbt.entities).toEqual([{ pos: [0.75, 0.5, 0.75], blockPos: [0, 0, 0], nbt: { id: 'minecraft:pig', Pos: [0.75, 0.5, 0.75], Rotation: [37.5, 0] } }])
  })
  it('exports a profile-validated ordinary block and rejects profile block entities and unsupported entity types', () => {
    const profile = gameProfileSchema.parse({schemaVersion:1,gameVersion:'26.2',dataVersion:4903,sourceSha1:'0123456789abcdef0123456789abcdef01234567',entities:[],entityModels:{}, creativeTabs: [], blocks: [
      { id: 'minecraft:custom_stone', translationKey: 'block.example.custom_stone', defaults: {}, properties: {}, tags: [], item: 'minecraft:custom_stone', stateCount: 1, hasBlockEntity: false, gravity: false, friction: 0.6, blastResistance: 6, renderShape: 'MODEL', lightEmission: 0 },
      { id: 'minecraft:custom_chest', translationKey: 'block.example.custom_chest', defaults: {}, properties: {}, tags: [], item: 'minecraft:custom_chest', stateCount: 1, hasBlockEntity: true, gravity: false, friction: 0.6, blastResistance: 6, renderShape: 'MODEL', lightEmission: 0 },
    ] })
    const catalog = profileMaterials(profile), p = newProject()
    p.blocks = [{ pos: [-1, 0, 0], state: { name: 'minecraft:custom_stone', properties: {} } }]
    expect(decode(gunzipSync(exportStructure(p, catalog).bytes)).palette[0].Name).toBe('minecraft:custom_stone')
    p.blocks[0].state.name = 'minecraft:custom_chest'
    expect(() => exportStructure(p, catalog)).toThrow('block entity')
    p.blocks = []; p.entities = [{ id: 'unknown-1', type: 'minecraft:warden', position: [0, 0, 0], yaw: 0 }]
    expect(() => exportStructure(p, catalog)).toThrow('entity loại này')
  })
})
describe('resource packs', () => {
  const png = new Uint8Array([137, 80, 78, 71])
  const make = (meta: object, extra: Record<string, Uint8Array> = {}) => zipSync({ 'pack.mcmeta': strToU8(JSON.stringify(meta)), 'assets/minecraft/textures/block/oak_log.png': png, ...extra })
  it('indexes block/entity assets while excluding executable files', () => {
    const p = parsePack(make({ pack: { min_format: [88, 0], max_format: [88, 0] } }, { 'assets/minecraft/textures/entity/pig/pig.png': png, 'assets/minecraft/models/block/oak_log.json': strToU8('{}'), 'evil.class': png }), 'pack.zip')
    expect(p.counts).toEqual({ textures: 2, entityTextures: 1, models: 1, blockstates: 0 }); expect(p.files['evil.class']).toBeUndefined()
  })
  it('validates version and compatibility', () => {
    expect(() => parsePack(make({ pack: { pack_format: 69 } }), 'old.zip')).toThrow('format 88')
    expect(() => parsePack(make({ pack: { min_format: [88, 1], max_format: [88, 2] } }), 'future.zip')).toThrow('format 88')
    expect(() => parsePack(zipSync({ 'version.json': strToU8(JSON.stringify({ id: '26.1', world_version: 4791 })) }), 'old.jar')).toThrow('26.2')
    expect(() => parsePack(zipSync({ 'nothing.txt': png }), 'empty.zip')).toThrow()
    expect(() => parsePack(new Uint8Array([0, 1, 2]), 'broken.zip')).toThrow()
  })
  it('rejects traversal paths', () => {
    expect(() => parsePack(make({ pack: { pack_format: 88 } }, { '../escape.png': png }), 'bad.zip')).toThrow('Đường dẫn')
  })
  it('respects enabled state and priority', () => {
    const low = parsePack(make({ pack: { pack_format: 88 } }), 'low.zip'), high = structuredClone(low)
    high.id = 'high'; high.priority = low.priority + 1
    const path = 'assets/minecraft/textures/block/oak_log.png'; high.files[path] = new Uint8Array([1])
    expect(asset([low, high], path)).toEqual(new Uint8Array([1]))
    high.enabled = false; expect(asset([high, low], path)).toEqual(png)
  })
  it('maps log end faces by axis', () => {
    expect(texturePaths('minecraft:oak_log', { axis: 'x' })[0]).toContain('oak_log_top.png')
    expect(texturePaths('minecraft:oak_log', { axis: 'y' })[2]).toContain('oak_log_top.png')
  })
})
