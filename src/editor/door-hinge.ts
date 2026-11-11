import { blockAdapter, WOOD_TYPES } from "../core/adapter-registry";
import { validateState, type Material } from "../core/catalog";
import { key, type Block, type BlockState, type Vec3 } from "../core/schema";

// Exact vanilla 26.2 collision predicates, checked by DoorHingeCases against the
// matching runtime. Neither appearance, tags nor a horizontal sturdy face proves
// isCollisionShapeFullBlock. Unknown neighboring states keep the explicit hinge.
export const DOOR_FULL_CUBE_IDS: readonly string[] = [
  "stone", "stone_bricks", "cobblestone", "dirt", "grass_block", "coarse_dirt",
  "podzol", "rooted_dirt", "mycelium", "clay", "glass", "bricks", "deepslate",
  "cobbled_deepslate", "polished_andesite", "andesite", "diorite", "granite",
  "sandstone", "red_sandstone", "blackstone", "end_stone", "obsidian",
  "bamboo_block", "stripped_bamboo_block", "bamboo_mosaic",
  ...WOOD_TYPES.map((wood) => `${wood}_planks`),
  ...WOOD_TYPES.filter((wood) => !["bamboo", "crimson", "warped"].includes(wood))
    .flatMap((wood) => [`${wood}_log`, `${wood}_wood`, `stripped_${wood}_log`, `stripped_${wood}_wood`]),
  "crimson_stem", "warped_stem", "crimson_hyphae", "warped_hyphae",
  "stripped_crimson_stem", "stripped_warped_stem", "stripped_crimson_hyphae", "stripped_warped_hyphae",
].map((id) => `minecraft:${id}`);
const full = new Set(DOOR_FULL_CUBE_IDS);
const empty = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

/** Call only after registry validation; undefined is an unsupported predicate. */
export function doorCollisionFullBlock(state: BlockState): boolean | undefined {
  if (full.has(state.name)) return true;
  if (empty.has(state.name)) return false;
  const adapter = blockAdapter(state.name);
  if (adapter?.context === "slab") return state.properties.type === "double";
  if (adapter?.context === "stairs" || adapter?.context === "chain" || adapter?.logical === "door") return false;
  return undefined;
}

/** DoorBlock.getHinge: four collision cells, lower neighboring doors, then hit
 * side. This changes only the newly placed pair, never an existing neighbor. */
export function contextDoorHinge(
  facing: string, pos: Vec3, point: Vec3,
  occupied: ReadonlyMap<string, Block>, catalog: Material[],
): "left" | "right" | undefined {
  const directions: Record<string, Vec3> = { north: [0, 0, -1], east: [1, 0, 0], south: [0, 0, 1], west: [-1, 0, 0] };
  const forward = directions[facing];
  if (!forward) return undefined;
  const left: Vec3 = [forward[2], 0, -forward[0]];
  const neighbors = [-1, 1].flatMap((side) => [0, 1].map((height) => {
    const at: Vec3 = [pos[0] + left[0] * side, pos[1] + height, pos[2] + left[2] * side];
    return occupied.get(key(at))?.state ?? { name: "minecraft:air", properties: {} };
  }));
  const predicates: boolean[] = [];
  for (const state of neighbors) {
    // Sparse omission is air. Explicit cells must be legal, even known IDs.
    if (empty.has(state.name) && Object.keys(state.properties).length) return undefined;
    if (!empty.has(state.name)) {
      const material = catalog.find((item) => item.id === state.name);
      if (!material) return undefined;
      try { validateState(state, [material]); } catch { return undefined; }
    }
    const value = doorCollisionFullBlock(state);
    if (value === undefined) return undefined;
    predicates.push(value);
  }
  // Enumeration above is right lower/upper, then left lower/upper.
  const balance = Number(predicates[0]) + Number(predicates[1]) - Number(predicates[2]) - Number(predicates[3]);
  const lowerDoor = (state: BlockState) => blockAdapter(state.name)?.logical === "door" && state.properties.half === "lower";
  const rightDoor = lowerDoor(neighbors[0]), leftDoor = lowerDoor(neighbors[2]);
  if ((leftDoor && !rightDoor) || balance > 0) return "right";
  if ((rightDoor && !leftDoor) || balance < 0) return "left";
  const x = point[0] - pos[0], z = point[2] - pos[2];
  return (forward[0] < 0 && z < 0.5) || (forward[0] > 0 && z > 0.5) ||
    (forward[2] < 0 && x > 0.5) || (forward[2] > 0 && x < 0.5) ? "right" : "left";
}
