import { describe, expect, it } from 'vitest'
import { Ray, Vector3 } from 'three'
import type { SceneBlock, Vec3 } from '../core/schema'
import { CellPicker } from './cell-picking'

const block = (pos: Vec3, name = 'minecraft:iron_chain', owner = pos.join(',')): SceneBlock => ({ pos, owner, state: { name, properties: {} } })
const ray = (origin: Vec3, direction: Vec3) => new Ray(new Vector3(...origin), new Vector3(...direction).normalize())

describe('editor cell picking', () => {
  it('selects empty-looking portions of thin cells without changing model geometry', () => {
    const chain = block([0, 0, 0])
    const hit = new CellPicker([chain]).hit(ray([.05, .95, -4], [0, 0, 1]))!
    expect(hit.block).toBe(chain)
    expect(hit.point).toEqual([.05, .95, 0])
    expect(hit.face).toEqual([0, 0, -1])
  })
  it('returns the nearest cell across chunks and negative coordinates, regardless of input order', () => {
    const front = block([-17, 0, 0]), back = block([16, 0, 0])
    const picker = new CellPicker([back, front])
    expect(picker.hit(ray([-30, .5, .5], [1, 0, 0]))?.block).toBe(front)
    expect(picker.hit(ray([30, .5, .5], [-1, 0, 0]))?.block).toBe(back)
  })
  it('reports an exact underside face and outward face from inside a cell', () => {
    const picker = new CellPicker([block([0, 2, 0])])
    expect(picker.hit(ray([.1, 0, .1], [0, 1, 0]))).toMatchObject({ face: [0, -1, 0], point: [.1, 2, .1] })
    expect(picker.hit(ray([.5, 2.5, .5], [0, 1, 0]))).toMatchObject({ face: [0, 1, 0], point: [.5, 3, .5] })
  })
  it('does not select air, holes in a group bounds, or excluded cells', () => {
    const picker = new CellPicker([block([0, 0, 0], 'minecraft:air'), block([0, 2, 0]), block([0, 4, 0])])
    expect(picker.hit(ray([.5, .5, -4], [0, 0, 1]))).toBeUndefined()
    expect(picker.hit(ray([.5, 3.5, -4], [0, 0, 1]))).toBeUndefined()
    expect(picker.hit(ray([.5, 2.5, -4], [0, 0, 1]), b => b.pos[1] !== 2)).toBeUndefined()
  })
  it('supports an explicit placement family filter without intercepting slab surfaces', () => {
    const picker = new CellPicker([block([0, 0, 0], 'minecraft:stone_slab'), block([0, 0, 2])])
    expect(picker.hit(ray([.1, .9, -4], [0, 0, 1]), b => b.state.name === 'minecraft:iron_chain')?.block.pos).toEqual([0, 0, 2])
  })
})
