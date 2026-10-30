import { Box3, Ray, Vector3 } from 'three'
import type { SceneBlock, Vec3 } from '../core/schema'

type Chunk = { box: Box3; blocks: SceneBlock[] }
export type CellHit = { block: SceneBlock; point: Vec3; face: Vec3; distance: number }
const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

/** Editor interaction bounds, not Minecraft collision/support shapes.
 * Built at scene changes; chunk rejection avoids scanning every cell on hover.
 */
export class CellPicker {
  private chunks: Chunk[]
  constructor(blocks: readonly SceneBlock[]) {
    const chunks = new Map<string, Chunk>()
    for (const block of blocks) {
      if (AIR.has(block.state.name)) continue
      const origin = block.pos.map(value => Math.floor(value / 16) * 16) as Vec3
      const id = origin.join(',')
      let chunk = chunks.get(id)
      if (!chunk) {
        chunk = { box: new Box3(new Vector3(...origin), new Vector3(...origin).addScalar(16)), blocks: [] }
        chunks.set(id, chunk)
      }
      chunk.blocks.push(block)
    }
    this.chunks = [...chunks.values()]
  }
  hit(ray: Ray, eligible?: (block: SceneBlock) => boolean): CellHit | undefined {
    const point = new Vector3(), box = new Box3()
    const candidates: { chunk: Chunk; distance: number }[] = []
    for (const chunk of this.chunks) {
      if (!ray.intersectBox(chunk.box, point)) continue
      candidates.push({ chunk, distance: chunk.box.containsPoint(ray.origin) ? 0 : point.distanceTo(ray.origin) })
    }
    candidates.sort((a, b) => a.distance - b.distance)
    let nearest: CellHit | undefined
    for (const { chunk, distance } of candidates) {
      if (nearest && distance > nearest.distance) break
      for (const block of chunk.blocks) {
        if (eligible && !eligible(block)) continue
        box.min.set(...block.pos); box.max.copy(box.min).addScalar(1)
        if (!ray.intersectBox(box, point)) continue
        const distance = point.distanceTo(ray.origin)
        if (nearest && distance >= nearest.distance) continue
        // Axis ties use X/Y/Z order deterministically, including exact edges.
        let axis = 0, sign = -1, error = Infinity
        for (let i = 0; i < 3; i++) {
          for (const side of [-1, 1]) {
            const boundary = block.pos[i] + (side === 1 ? 1 : 0)
            const delta = Math.abs(point.getComponent(i) - boundary)
            if (delta < error) { error = delta; axis = i; sign = side }
          }
        }
        const face: Vec3 = [0, 0, 0]; face[axis] = sign
        nearest = { block, point: point.toArray(), face, distance }
      }
    }
    return nearest
  }
}
