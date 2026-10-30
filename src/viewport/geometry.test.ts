import { describe, expect, it } from 'vitest'
import { defaultState } from '../core/catalog'
import { blockGeometry } from './geometry'
describe('voxel geometry', () => {
  it.each(['bottom', 'top', 'double'])('keeps a %s slab inside its block cell', type => {
    const state = defaultState('minecraft:stone_brick_slab'); state.properties.type = type
    const geometry = blockGeometry(state); geometry.computeBoundingBox()
    expect(geometry.boundingBox!.min.y).toBe(type === 'top' ? 0 : -.5)
    expect(geometry.boundingBox!.max.y).toBe(type === 'bottom' ? 0 : .5)
    geometry.dispose()
  })
  it.each(['north', 'east', 'south', 'west'])('builds straight %s stairs with six material slots', facing => {
    const state = defaultState('minecraft:oak_stairs'); state.properties.facing = facing
    const geometry = blockGeometry(state); geometry.computeBoundingBox()
    expect(geometry.index!.count).toBe(72)
    expect(geometry.groups).toHaveLength(12)
    expect(geometry.groups.every(g => g.materialIndex! < 6)).toBe(true)
    for (const value of geometry.boundingBox!.min.toArray()) expect(value).toBeCloseTo(-.5)
    for (const value of geometry.boundingBox!.max.toArray()) expect(value).toBeCloseTo(.5)
    geometry.dispose()
  })
})
