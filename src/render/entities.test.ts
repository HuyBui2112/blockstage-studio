import { describe, expect, it } from 'vitest'
import { gameProfileSchema } from '../core/profile'
import type { EntityModelPart } from '../core/profile'
import { bakeEntity, blockEntityAppearance, entityAppearance } from './entities'

const quad = [[0, 0, 0, 0, 0], [16, 0, 0, 1, 0], [16, 16, 0, 1, 1], [0, 16, 0, 0, 1]] as [number, number, number, number, number][]
const part = (overrides: Partial<EntityModelPart> = {}): EntityModelPart => ({
  position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number],
  polygons: [quad], omittedPolygons: 0, children: {}, ...overrides,
})

describe('entity model baking', () => {
  it('maps waxed/weathered copper chest halves to vanilla shared chest geometry and exact texture', () => {
    expect(blockEntityAppearance('minecraft:waxed_weathered_copper_chest',{type:'left'})).toEqual({layer:'minecraft:double_chest_left#main',texture:'assets/minecraft/textures/entity/chest/copper_weathered_left.png'})
    expect(blockEntityAppearance('minecraft:oxidized_copper_chest',{type:'single'})).toEqual({layer:'minecraft:chest#main',texture:'assets/minecraft/textures/entity/chest/copper_oxidized.png'})
    expect(blockEntityAppearance('minecraft:shulker_box',{})).toBeUndefined()
  })
  it('bakes hierarchical quads into finite positions, UVs and normals in block units', () => {
    const root = part({ position: [16, 0, 0], children: { raised: part({ position: [0, 16, 0] }) } })
    const mesh = bakeEntity(root, 'pig.png', 'block'), geometry = mesh.geometry
    const positions = geometry.getAttribute('position'), uvs = geometry.getAttribute('uv'), normals = geometry.getAttribute('normal')

    expect(positions.count).toBe(12)
    expect(Array.from(positions.array.slice(0, 6))).toEqual([0.5, -0.5, -0.5, 1.5, -0.5, -0.5])
    expect(Array.from(positions.array.slice(18, 24))).toEqual([0.5, 0.5, -0.5, 1.5, 0.5, -0.5])
    expect(Array.from(uvs.array.slice(0, 4))).toEqual([0, 1, 1, 1])
    expect(Array.from(normals.array).every(Number.isFinite)).toBe(true)
    expect(normals.getX(0)).toBeCloseTo(0); expect(normals.getY(0)).toBeCloseTo(0); expect(normals.getZ(0)).toBeCloseTo(1)
    expect(mesh.surfaces).toEqual([{ texture: 'pig.png', tint: false, shade: true }])
  })

  it('rejects a model whose importer recorded omitted polygons', () => {
    expect(() => bakeEntity(part({ omittedPolygons: 2 }), 'pig.png')).toThrow('2 polygon UV không hợp lệ')
  })

  it('resolves an appearance only when both the profile layer and texture are present', () => {
    const profile = gameProfileSchema.parse({
      schemaVersion: 1, gameVersion: '26.2', dataVersion: 4903, sourceSha1: '0123456789abcdef0123456789abcdef01234567',
      blocks: [{ id: 'minecraft:stone', translationKey: 'block.minecraft.stone', defaults: {}, properties: {}, stateCount: 1, hasBlockEntity: false, gravity: false, friction: 0.6, blastResistance: 6, item: 'minecraft:stone' }],
      entities: [], creativeTabs: [], entityModels: { 'minecraft:pig#main': part() },
    })
    const texture = 'assets/minecraft/textures/entity/pig/pig_temperate.png'
    expect(entityAppearance('minecraft:pig', profile, { files: new Set([texture]) } as never)).toEqual({ layer: 'minecraft:pig#main', texture })
    expect(entityAppearance('minecraft:pig', profile, { files: new Set() } as never)).toBeUndefined()
    expect(entityAppearance('minecraft:warden', profile, { files: new Set([texture]) } as never)).toBeUndefined()
  })
})
