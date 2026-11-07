import { blockAdapter, DYE_COLORS, WOOD_TYPES } from "./adapter-registry";
import { validateState, type Material } from "./catalog";
import { blockEntitySchema, type Block, type BlockState } from "./schema";

/** Vertical World planes only; this operation is geometric, not a world update. */
export type MirrorPlane = "yz" | "xy";
export type MirrorStateCapability = Readonly<{
  supported: boolean;
  reason: string;
  adapterId: string;
  evidence: readonly string[];
}>;
const ids = (names: string) => new Set(names.split(/\s+/).map((name) => `minecraft:${name}`));
const cubes = ids("air cave_air void_air stone stone_bricks cracked_stone_bricks mossy_stone_bricks chiseled_stone_bricks cobblestone mossy_cobblestone bricks dirt coarse_dirt rooted_dirt grass_block glass sand red_sand gravel bedrock obsidian crying_obsidian andesite diorite granite polished_andesite polished_diorite polished_granite deepslate cobbled_deepslate polished_deepslate deepslate_bricks deepslate_tiles tuff calcite smooth_stone sandstone red_sandstone smooth_sandstone smooth_red_sandstone quartz_block smooth_quartz clay terracotta mud packed_mud mud_bricks netherrack nether_bricks red_nether_bricks blackstone polished_blackstone end_stone end_stone_bricks prismarine prismarine_bricks dark_prismarine sea_lantern glowstone iron_block gold_block diamond_block emerald_block copper_block coal_block netherite_block bamboo_mosaic");
for (const wood of WOOD_TYPES) cubes.add(`minecraft:${wood}_planks`);
for (const color of DYE_COLORS)
  for (const suffix of ["wool", "concrete", "concrete_powder", "terracotta", "stained_glass"])
    cubes.add(`minecraft:${color}_${suffix}`);
const leaves = ids("oak_leaves spruce_leaves birch_leaves jungle_leaves acacia_leaves dark_oak_leaves mangrove_leaves cherry_leaves pale_oak_leaves azalea_leaves flowering_azalea_leaves");
const fences = new Set(WOOD_TYPES.map((wood) => `minecraft:${wood}_fence`));
fences.add("minecraft:nether_brick_fence");
const gates = new Set(WOOD_TYPES.map((wood) => `minecraft:${wood}_fence_gate`));
const walls = ids("cobblestone_wall mossy_cobblestone_wall");
const allowed: Record<string, readonly string[]> = {
  cube: [], grass: ["snowy"], leaves: ["distance", "persistent", "waterlogged"],
  pillar: ["axis"], chain: ["axis", "waterlogged"], lantern: ["hanging", "waterlogged"],
  slab: ["type", "waterlogged"], stairs: ["facing", "half", "shape", "waterlogged"],
  door: ["facing", "half", "hinge", "open", "powered"], bed: ["facing", "part", "occupied"],
  chest: ["facing", "type", "waterlogged"], fence: ["north", "east", "south", "west", "waterlogged"],
  wall: ["north", "east", "south", "west", "up", "waterlogged"],
  gate: ["facing", "in_wall", "open", "powered"],
};
function family(state: BlockState): string | undefined {
  if (state.name === "minecraft:grass_block") return "grass";
  if (cubes.has(state.name)) return "cube";
  if (leaves.has(state.name)) return "leaves";
  if (state.name === "minecraft:chest") return "chest";
  if (fences.has(state.name)) return "fence";
  if (gates.has(state.name)) return "gate";
  if (walls.has(state.name)) return "wall";
  return blockAdapter(state.name)?.context;
}
function reflected(state: BlockState, plane: MirrorPlane): BlockState {
  const properties = { ...state.properties };
  const [a, b] = plane === "yz" ? ["east", "west"] : ["north", "south"];
  if (properties.facing === a) properties.facing = b;
  else if (properties.facing === b) properties.facing = a;
  if (Object.hasOwn(properties, a) && Object.hasOwn(properties, b))
    [properties[a], properties[b]] = [properties[b], properties[a]];
  // Reflection reverses handedness even when facing lies in the mirror plane.
  const shapes: Record<string, string> = {
    inner_left: "inner_right", inner_right: "inner_left",
    outer_left: "outer_right", outer_right: "outer_left",
  };
  if (properties.shape && shapes[properties.shape]) properties.shape = shapes[properties.shape];
  if (properties.hinge === "left") properties.hinge = "right";
  else if (properties.hinge === "right") properties.hinge = "left";
  return { name: state.name, properties };
}

export function mirrorStateCapability(
  state: BlockState, material: Material | undefined, plane: MirrorPlane,
  payload?: Block["blockEntity"],
): MirrorStateCapability {
  const kind = family(state);
  const adapterId = `blockstage:mirror-${kind ?? "unsupported"}-v1`;
  const decision = (supported: boolean, reason: string): MirrorStateCapability => ({
    supported, reason, adapterId,
    evidence: ["editor-contract:geometric-vertical-mirror-v1", ...(blockAdapter(state.name)?.provenance ?? [])],
  });
  if (plane !== "yz" && plane !== "xy") return decision(false, "Mirror supports only vertical World YZ and XY planes");
  if (!material || material.id !== state.name) return decision(false, `Registry unavailable for ${state.name}`);
  if (!kind || !allowed[kind]) return decision(false, `No finite mirror adapter for ${state.name}`);
  const unknown = Object.keys(state.properties).find((property) => !allowed[kind].includes(property));
  if (unknown) return decision(false, `Mirror adapter does not support ${unknown} on ${state.name}`);
  const boolean = ["false", "true"];
  const values: Record<string, readonly string[]> = {
    axis: ["x", "y", "z"], facing: ["north", "east", "south", "west"],
    shape: ["straight", "inner_left", "inner_right", "outer_left", "outer_right"],
    hinge: ["left", "right"], part: ["foot", "head"],
    half: kind === "door" ? ["lower", "upper"] : ["bottom", "top"],
    type: kind === "chest" ? ["single", "left", "right"] : ["bottom", "top", "double"],
    distance: ["1", "2", "3", "4", "5", "6", "7"],
  };
  for (const [property, value] of Object.entries(state.properties)) {
    const domain = values[property] ??
      (kind === "wall" && ["north", "east", "south", "west"].includes(property)
        ? ["none", "low", "tall"] : boolean);
    if (!domain.includes(value)) return decision(false, `Mirror adapter does not support ${property}=${value} on ${state.name}`);
  }
  if (kind === "chest" && state.properties.type !== "single") return decision(false, "Mirror supports only single minecraft:chest cells");
  if (payload !== undefined && (!blockEntitySchema.safeParse(payload).success || kind !== "chest"))
    return decision(false, "Mirror requires a valid single-chest payload owner");
  try {
    validateState(state, [material]);
    validateState(reflected(state, plane), [material]);
  } catch (error) {
    return decision(false, error instanceof Error ? error.message : "Invalid mirror blockstate");
  }
  return decision(true, "Finite geometric mirror across vertical World YZ/XY planes; full owner footprints and final candidate require validation");
}

export function mirrorBlockState(
  state: BlockState, plane: MirrorPlane, material: Material | undefined,
  payload?: Block["blockEntity"],
): BlockState {
  const capability = mirrorStateCapability(state, material, plane, payload);
  if (!capability.supported) throw new Error(capability.reason);
  return reflected(state, plane);
}
