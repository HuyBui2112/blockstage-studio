import type { SceneBlock, Vec3 } from '../core/schema'

/** Integer chunk coordinates; floor keeps negative cells in their containing chunk. */
export const sceneChunkKey = (pos: Vec3): string => pos.map(value => Math.floor(value / 16)).join(',')

export type SceneChunkUpdate = {
  changed: Map<string, readonly SceneBlock[]>
  removed: string[]
  chunks: ReadonlyMap<string, readonly SceneBlock[]>
}

function sameBlock(a: SceneBlock, b: SceneBlock): boolean {
  if (a === b) return true
  if (a.owner !== b.owner || a.pos.some((value, axis) => value !== b.pos[axis])) return false
  if (a.state === b.state) return true
  if (a.state.name !== b.state.name) return false
  const aProperties = a.state.properties, bProperties = b.state.properties
  if (aProperties === bProperties) return true
  const keys = Object.keys(aProperties)
  return keys.length === Object.keys(bProperties).length && keys.every(key =>
    Object.hasOwn(bProperties, key) && aProperties[key] === bProperties[key])
}

/** Render snapshots own their arrays and retain immutable source blocks, including air.
 * Per-chunk input order is significant for deterministic equal-distance picking.
 */
export class SceneChunks {
  private chunks: ReadonlyMap<string, readonly SceneBlock[]> = new Map()

  update(blocks: readonly SceneBlock[], force = false): SceneChunkUpdate {
    const grouped = new Map<string, SceneBlock[]>()
    for (const block of blocks) {
      const key = sceneChunkKey(block.pos)
      const chunk = grouped.get(key)
      if (chunk) chunk.push(block)
      else grouped.set(key, [block])
    }
    const chunks = new Map<string, readonly SceneBlock[]>()
    const changed = new Map<string, readonly SceneBlock[]>()
    for (const [key, blocks] of grouped) {
      const previous = this.chunks.get(key)
      const equal = previous?.length === blocks.length && blocks.every((block, index) => sameBlock(previous[index], block))
      const snapshot = equal ? previous : blocks
      chunks.set(key, snapshot)
      if (force || !equal) changed.set(key, snapshot)
    }
    const removed = [...this.chunks.keys()].filter(key => !chunks.has(key))
    this.chunks = chunks
    return { changed, removed, chunks }
  }

  clear(): void {
    this.chunks = new Map()
  }
}
