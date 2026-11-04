import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Matrix4, MeshBasicMaterial, Texture } from 'three'
import type { SceneBlock, Vec3 } from '../core/schema'
import { BlockScene, type BlockAppearance } from './block-scene'

const block = (pos: Vec3, owner = pos.join(','), name = 'minecraft:stone', properties: Record<string, string> = {}): SceneBlock =>
  ({ pos, owner, state: { name, properties } })
function fixture() {
  const texture = new Texture(), geometry = new BoxGeometry(), material = new MeshBasicMaterial({ map: texture })
  const appearance: BlockAppearance = { key: 'shared', geometry, materials: [material], fallback: false, issues: [] }
  const resolve = vi.fn((_block: SceneBlock) => appearance)
  const scene = new BlockScene(new Group())
  return { scene, resolve, appearance, geometry, material, texture }
}
function snapshot(scene: BlockScene) {
  return scene.batches.flatMap(mesh => (mesh.userData.blocks as SceneBlock[]).map((block, index) => {
    const matrix = new Matrix4(); mesh.getMatrixAt(index, matrix)
    return { owner: block.owner, pos: block.pos, state: block.state, matrix: matrix.toArray() }
  }))
}

describe('incremental block scene', () => {
  it('reuses meshes for clone-equal chunks without resolving appearances', () => {
    const { scene, resolve } = fixture()
    const blocks = [block([-1, 0, 0]), block([16, 2, 0])]
    scene.update(blocks, resolve)
    const meshes = [...scene.batches]
    resolve.mockClear()
    const result = scene.update(structuredClone(blocks), resolve)
    expect(resolve).not.toHaveBeenCalled()
    expect(scene.batches[0]).toBe(meshes[0]); expect(scene.batches[1]).toBe(meshes[1])
    expect(result.work).toMatchObject({ changedChunks: 0, createdBatches: 0, retainedBatches: 2, resolvedCells: 0 })
  })

  it('refreshes only old and new negative chunks when a cell crosses a boundary', () => {
    const { scene, resolve } = fixture()
    const stable = block([32, 0, 0]), stay = block([-16, 0, 0], 'stay')
    scene.update([stay, block([-1, 0, 0], 'moving'), stable], resolve)
    const stableMesh = scene.batches[1]
    resolve.mockClear()
    const moved = block([-17, 0, 0], 'moving')
    const result = scene.update([stay, moved, stable], resolve)
    expect(result.work).toMatchObject({ changedChunks: 2, createdBatches: 2, retainedBatches: 1, resolvedCells: 2 })
    expect(resolve.mock.calls.map(([value]) => value)).toEqual([stay, moved])
    expect(scene.batches[2]).toBe(stableMesh)
  })

  it('refreshes userData for same-cell state changes and owner-only replacements', () => {
    const { scene, resolve } = fixture()
    const variants = [block([0, 0, 0]), block([0, 0, 0], 'replacement'),
      block([0, 0, 0], 'replacement', 'minecraft:oak_log', { axis: 'x' }),
      block([0, 0, 0], 'replacement', 'minecraft:oak_log', { axis: 'z' })]
    for (const value of variants) {
      const previous = scene.batches[0]
      scene.update([value], resolve)
      expect(scene.batches[0]).not.toBe(previous)
      expect(scene.batches[0].userData.blocks).toEqual([value])
      expect(scene.batches[0].userData.blocks[0]).toBe(value)
    }
  })

  it('resolves position-dependent appearances after a move inside the same chunk', () => {
    const { scene, appearance } = fixture()
    const alternateGeometry = new BoxGeometry(.5, 1, .5), alternateMaterial = new MeshBasicMaterial({ color: 'red' })
    const resolve = vi.fn((value: SceneBlock) => value.pos[0] === 1
      ? { ...appearance, key: 'position-one', geometry: alternateGeometry, materials: [alternateMaterial] }
      : appearance)
    const distant = block([32, 0, 0], 'distant')
    scene.update([block([0, 0, 0], 'moving'), distant], resolve)
    const oldMovingMesh = scene.batches[0], distantMesh = scene.batches[1]
    resolve.mockClear()
    const moved = block([1, 0, 0], 'moving')
    const result = scene.update([moved, distant], resolve)
    expect(resolve.mock.calls.map(([value]) => value)).toEqual([moved])
    expect(result.work).toMatchObject({ changedChunks: 1, createdBatches: 1, retainedBatches: 1, resolvedCells: 1 })
    expect(scene.batches[0]).not.toBe(oldMovingMesh)
    expect(scene.batches[0].geometry).toBe(alternateGeometry)
    expect(scene.batches[0].material).toEqual([alternateMaterial])
    expect(scene.batches[0].userData.blocks).toEqual([moved])
    expect(snapshot(scene)[0].matrix.slice(12, 15)).toEqual([1.5, .5, .5])
    expect(scene.batches[1]).toBe(distantMesh)
  })

  it('writes center translations and preserves instance order within appearance batches', () => {
    const { scene, appearance } = fixture()
    const a = block([2, 3, 4], 'a'), b = block([5, 6, 7], 'b'), c = block([1, 2, 3], 'c')
    const resolve = (value: SceneBlock) => ({ ...appearance, key: value.owner === 'b' ? 'other' : 'shared' })
    scene.update([a, b, c], resolve)
    expect(scene.batches.map(mesh => mesh.userData.blocks)).toEqual([[a, c], [b]])
    expect(snapshot(scene).map(value => value.matrix.slice(12, 15))).toEqual([[2.5, 3.5, 4.5], [1.5, 2.5, 3.5], [5.5, 6.5, 7.5]])
    scene.update([c, b, a], resolve)
    expect(scene.batches[0].userData.blocks).toEqual([c, a])
    expect(snapshot(scene).map(value => value.owner)).toEqual(['c', 'a', 'b'])
  })

  it('matches a fresh full scene across removal, Undo, Redo and whole scene replacement', () => {
    const { scene, resolve } = fixture()
    const original = [block([-17, 0, 0]), block([0, 2, 0]), block([16, 0, 0])]
    const edited = [original[2], block([0, 2, 0], 'new', 'minecraft:oak_log', { axis: 'y' })]
    for (const blocks of [original, edited, original, edited, [block([80, -20, 32])], []]) {
      scene.update(blocks, resolve)
      const full = new BlockScene(new Group()); full.update(blocks, resolve)
      expect(snapshot(scene)).toEqual(snapshot(full))
      expect(scene.group.children.length).toBe(scene.batches.length)
      full.clear()
    }
  })

  it('force rebuilds all current chunks with new appearance references', () => {
    const { scene, resolve, appearance } = fixture()
    const blocks = [block([-1, 0, 0]), block([16, 0, 0])]
    scene.update(blocks, resolve)
    const previous = [...scene.batches]
    const nextGeometry = new BoxGeometry(), nextMaterial = new MeshBasicMaterial()
    const nextResolve = vi.fn(() => ({ ...appearance, geometry: nextGeometry, materials: [nextMaterial] }))
    const result = scene.update(blocks, nextResolve, true)
    expect(result.work).toMatchObject({ changedChunks: 2, createdBatches: 2, retainedBatches: 0, resolvedCells: 2 })
    for (const mesh of scene.batches) {
      expect(previous).not.toContain(mesh)
      expect(mesh.geometry).toBe(nextGeometry); expect(mesh.material).toEqual([nextMaterial])
    }
  })

  it('disposes each replaced or removed mesh once and never shared resources', () => {
    const { scene, resolve, geometry, material, texture } = fixture()
    const resourceDisposals = [vi.spyOn(geometry, 'dispose'), vi.spyOn(material, 'dispose'), vi.spyOn(texture, 'dispose')]
    scene.update([block([0, 0, 0]), block([16, 0, 0])], resolve)
    const oldMeshes = [...scene.batches], oldDisposals = oldMeshes.map(mesh => vi.spyOn(mesh, 'dispose'))
    scene.update([block([0, 0, 0], 'new')], resolve)
    expect(oldDisposals.map(spy => spy.mock.calls.length)).toEqual([1, 1])
    const finalMesh = scene.batches[0], finalDispose = vi.spyOn(finalMesh, 'dispose')
    const event = vi.fn(); finalMesh.addEventListener('dispose', event)
    scene.clear(); scene.clear()
    expect(finalDispose).toHaveBeenCalledTimes(1); expect(event).toHaveBeenCalledTimes(1)
    expect(oldDisposals.map(spy => spy.mock.calls.length)).toEqual([1, 1])
    expect(scene.group.children).toEqual([]); expect(scene.batches).toEqual([])
    for (const spy of resourceDisposals) expect(spy).not.toHaveBeenCalled()
  })

  it('excludes all air variants while maintaining diagnostics through removal and restoration', () => {
    const { scene, appearance } = fixture()
    const resolve = vi.fn((value: SceneBlock) => ({ ...appearance, fallback: value.owner === 'fallback', issues: value.owner === 'fallback' ? ['missing model'] : [] }))
    const modeled = block([0, 0, 0], 'modeled'), fallback = block([16, 0, 0], 'fallback')
    const air = ['air', 'cave_air', 'void_air'].map((name, index) => block([32 + index, 0, 0], name, `minecraft:${name}`))
    const all = [modeled, fallback, ...air]
    expect(scene.update(all, resolve).diagnostics).toEqual({ modeledBlocks: 1, fallbackBlocks: 1, issues: ['missing model'] })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(snapshot(scene).length).toBe(2)
    expect(scene.update([modeled, ...air], resolve).diagnostics).toEqual({ modeledBlocks: 1, fallbackBlocks: 0, issues: [] })
    expect(scene.update(all, resolve).diagnostics).toEqual({ modeledBlocks: 1, fallbackBlocks: 1, issues: ['missing model'] })
    expect(scene.update(air, resolve).diagnostics).toEqual({ modeledBlocks: 0, fallbackBlocks: 0, issues: [] })
    expect(scene.batches).toEqual([])
  })
})
