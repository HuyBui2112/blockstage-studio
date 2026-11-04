import {
  Group,
  InstancedMesh,
  Matrix4,
  type BufferGeometry,
  type Material,
} from "three";
import type { SceneBlock } from "../core/schema";
import { SceneChunks } from "./scene-chunks";

export type BlockAppearance = {
  key: string;
  geometry: BufferGeometry;
  materials: Material[];
  fallback: boolean;
  issues: string[];
};
export type SceneUpdate = {
  chunks: number;
  changedChunks: number;
  removedChunks: number;
  createdBatches: number;
  retainedBatches: number;
  resolvedCells: number;
};
type ChunkMeshes = {
  meshes: InstancedMesh[];
  modeled: number;
  fallback: number;
  issues: Set<string>;
};
const AIR = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);

/** Owns instance buffers only. Geometry, materials and texture lifetimes belong
 * to the viewport resource caches; replacing a chunk must never dispose them. */
export class BlockScene {
  private index = new SceneChunks();
  private rendered = new Map<string, ChunkMeshes>();
  batches: InstancedMesh[] = [];
  readonly group: Group;
  constructor(group: Group) {
    this.group = group;
  }

  update(
    blocks: readonly SceneBlock[],
    resolve: (block: SceneBlock) => BlockAppearance,
    force = false,
  ) {
    const delta = this.index.update(blocks, force);
    for (const id of [...delta.removed, ...delta.changed.keys()])
      this.remove(id);
    let createdBatches = 0,
      resolvedCells = 0;
    for (const [id, cells] of delta.changed) {
      const chunk: ChunkMeshes = {
        meshes: [],
        modeled: 0,
        fallback: 0,
        issues: new Set(),
      };
      const groups = new Map<
        string,
        { appearance: BlockAppearance; blocks: SceneBlock[] }
      >();
      for (const block of cells) {
        if (AIR.has(block.state.name)) continue;
        const appearance = resolve(block);
        resolvedCells++;
        if (appearance.fallback) chunk.fallback++;
        else chunk.modeled++;
        for (const issue of appearance.issues) chunk.issues.add(issue);
        const batch = groups.get(appearance.key) ?? { appearance, blocks: [] };
        batch.blocks.push(block);
        groups.set(appearance.key, batch);
      }
      const matrix = new Matrix4();
      for (const { appearance, blocks } of groups.values()) {
        const mesh = new InstancedMesh(
          appearance.geometry,
          appearance.materials,
          blocks.length,
        );
        mesh.userData = { blocks };
        blocks.forEach((block, index) =>
          mesh.setMatrixAt(
            index,
            matrix.makeTranslation(
              block.pos[0] + 0.5,
              block.pos[1] + 0.5,
              block.pos[2] + 0.5,
            ),
          ),
        );
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        chunk.meshes.push(mesh);
        this.group.add(mesh);
        createdBatches++;
      }
      this.rendered.set(id, chunk);
    }
    // Match current input chunk order, including after Undo or scene replacement.
    const ordered = new Map<string, ChunkMeshes>(),
      issues = new Set<string>();
    let modeledBlocks = 0,
      fallbackBlocks = 0;
    this.batches = [];
    for (const id of delta.chunks.keys()) {
      const chunk = this.rendered.get(id)!;
      ordered.set(id, chunk);
      for (const mesh of chunk.meshes) this.batches.push(mesh);
      modeledBlocks += chunk.modeled;
      fallbackBlocks += chunk.fallback;
      for (const issue of chunk.issues) issues.add(issue);
    }
    this.rendered = ordered;
    const work: SceneUpdate = {
      chunks: ordered.size,
      changedChunks: delta.changed.size,
      removedChunks: delta.removed.length,
      createdBatches,
      retainedBatches: this.batches.length - createdBatches,
      resolvedCells,
    };
    return {
      chunks: delta.chunks,
      work,
      diagnostics: { modeledBlocks, fallbackBlocks, issues: [...issues] },
    };
  }
  private remove(id: string) {
    const chunk = this.rendered.get(id);
    if (!chunk) return;
    for (const mesh of chunk.meshes) {
      this.group.remove(mesh);
      mesh.dispose();
    }
    this.rendered.delete(id);
  }
  clear() {
    for (const id of this.rendered.keys()) this.remove(id);
    this.index.clear();
    this.batches = [];
  }
}
