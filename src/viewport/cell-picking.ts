import { Box3, Ray, Vector3 } from "three";
import type { SceneBlock, Vec3 } from "../core/schema";
import { SceneChunks } from "./scene-chunks";

type Chunk = { box: Box3; blocks: SceneBlock[]; source: readonly SceneBlock[] };
export type CellHit = {
  block: SceneBlock;
  point: Vec3;
  face: Vec3;
  distance: number;
};
const AIR = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);

/** Editor interaction bounds, not Minecraft collision/support shapes.
 * Built at scene changes; chunk rejection avoids scanning every cell on hover.
 */
export class CellPicker {
  private chunks = new Map<string, Chunk>();
  constructor(blocks: readonly SceneBlock[]) {
    this.updateChunks(new SceneChunks().update(blocks).chunks);
  }
  /** Shares immutable snapshots with rendering; retain unchanged interaction
   * cells but always follow current chunk order for equal-distance ray ties. */
  updateChunks(sources: ReadonlyMap<string, readonly SceneBlock[]>): void {
    const chunks = new Map<string, Chunk>();
    for (const [id, source] of sources) {
      if (!source.length) continue;
      const previous = this.chunks.get(id);
      if (previous?.source === source) {
        chunks.set(id, previous);
        continue;
      }
      const origin = source[0].pos.map(
        (value) => Math.floor(value / 16) * 16,
      ) as Vec3;
      chunks.set(id, {
        source,
        box: new Box3(
          new Vector3(...origin),
          new Vector3(...origin).addScalar(16),
        ),
        blocks: source.filter((block) => !AIR.has(block.state.name)),
      });
    }
    this.chunks = chunks;
  }
  hit(
    ray: Ray,
    eligible?: (block: SceneBlock) => boolean,
  ): CellHit | undefined {
    const point = new Vector3(),
      box = new Box3();
    const candidates: { chunk: Chunk; distance: number }[] = [];
    for (const chunk of this.chunks.values()) {
      if (!ray.intersectBox(chunk.box, point)) continue;
      candidates.push({
        chunk,
        distance: chunk.box.containsPoint(ray.origin)
          ? 0
          : point.distanceTo(ray.origin),
      });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let nearest: CellHit | undefined;
    for (const { chunk, distance } of candidates) {
      if (nearest && distance > nearest.distance) break;
      for (const block of chunk.blocks) {
        if (eligible && !eligible(block)) continue;
        box.min.set(...block.pos);
        box.max.copy(box.min).addScalar(1);
        if (!ray.intersectBox(box, point)) continue;
        const distance = point.distanceTo(ray.origin);
        if (nearest && distance >= nearest.distance) continue;
        // Axis ties use X/Y/Z order deterministically, including exact edges.
        let axis = 0,
          sign = -1,
          error = Infinity;
        for (let i = 0; i < 3; i++) {
          for (const side of [-1, 1]) {
            const boundary = block.pos[i] + (side === 1 ? 1 : 0);
            const delta = Math.abs(point.getComponent(i) - boundary);
            if (delta < error) {
              error = delta;
              axis = i;
              sign = side;
            }
          }
        }
        const face: Vec3 = [0, 0, 0];
        face[axis] = sign;
        nearest = { block, point: point.toArray(), face, distance };
      }
    }
    return nearest;
  }
}
