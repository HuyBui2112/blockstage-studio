/** Runtime adapter declarations for the supported game target.
 * Resource availability and world verification are separate capabilities. */
export const GAME_TARGET = Object.freeze({
  gameVersion: "26.2" as const,
  dataVersion: 4903 as const,
});

export function isSupportedTarget(target: {
  gameVersion: string;
  dataVersion: number;
}): boolean {
  return target.gameVersion === GAME_TARGET.gameVersion &&
    target.dataVersion === GAME_TARGET.dataVersion;
}

export const DYE_COLORS: readonly string[] = Object.freeze(
  "white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black".split(
    " ",
  ),
);
export const WOOD_TYPES: readonly string[] = Object.freeze(
  "oak spruce birch jungle acacia cherry dark_oak pale_oak mangrove bamboo crimson warped".split(
    " ",
  ),
);
const beds = new Set(DYE_COLORS.map((color) => `minecraft:${color}_bed`));
const doors = new Set(
  [
    ...WOOD_TYPES.map((wood) => `${wood}_door`),
    "iron_door",
    "copper_door",
    "exposed_copper_door",
    "weathered_copper_door",
    "oxidized_copper_door",
    "waxed_copper_door",
    "waxed_exposed_copper_door",
    "waxed_weathered_copper_door",
    "waxed_oxidized_copper_door",
  ].map((id) => `minecraft:${id}`),
);
const plants = new Set(
  "tall_seagrass sunflower lilac rose_bush peony tall_grass large_fern pitcher_plant small_dripleaf"
    .split(" ")
    .map((id) => `minecraft:${id}`),
);

const logs = new Set(
  `
minecraft:acacia_log minecraft:acacia_wood minecraft:bamboo_block minecraft:birch_log
minecraft:birch_wood minecraft:cherry_log minecraft:cherry_wood minecraft:crimson_hyphae
minecraft:crimson_stem minecraft:dark_oak_log minecraft:dark_oak_wood minecraft:jungle_log
minecraft:jungle_wood minecraft:mangrove_log minecraft:mangrove_wood minecraft:oak_log
minecraft:oak_wood minecraft:pale_oak_log minecraft:pale_oak_wood minecraft:spruce_log
minecraft:spruce_wood minecraft:stripped_acacia_log minecraft:stripped_acacia_wood minecraft:stripped_bamboo_block
minecraft:stripped_birch_log minecraft:stripped_birch_wood minecraft:stripped_cherry_log minecraft:stripped_cherry_wood
minecraft:stripped_crimson_hyphae minecraft:stripped_crimson_stem minecraft:stripped_dark_oak_log minecraft:stripped_dark_oak_wood
minecraft:stripped_jungle_log minecraft:stripped_jungle_wood minecraft:stripped_mangrove_log minecraft:stripped_mangrove_wood
minecraft:stripped_oak_log minecraft:stripped_oak_wood minecraft:stripped_pale_oak_log minecraft:stripped_pale_oak_wood
minecraft:stripped_spruce_log minecraft:stripped_spruce_wood minecraft:stripped_warped_hyphae minecraft:stripped_warped_stem
minecraft:warped_hyphae minecraft:warped_stem
`
    .trim()
    .split(/\s+/),
);
// Exact 26.2 ChainBlock/LanternBlock IDs, checked by the runtime oracle. The
// shared chain set also identifies cell-face placement targets for thin meshes.
export const CONTEXT_CHAIN_IDS: ReadonlySet<string> = new Set(
  `
minecraft:iron_chain minecraft:copper_chain minecraft:exposed_copper_chain
minecraft:weathered_copper_chain minecraft:oxidized_copper_chain minecraft:waxed_copper_chain
minecraft:waxed_exposed_copper_chain minecraft:waxed_weathered_copper_chain minecraft:waxed_oxidized_copper_chain
`
    .trim()
    .split(/\s+/),
);
const lanterns = new Set(
  `
minecraft:lantern minecraft:soul_lantern minecraft:copper_lantern minecraft:exposed_copper_lantern
minecraft:weathered_copper_lantern minecraft:oxidized_copper_lantern minecraft:waxed_copper_lantern
minecraft:waxed_exposed_copper_lantern minecraft:waxed_weathered_copper_lantern minecraft:waxed_oxidized_copper_lantern
`
    .trim()
    .split(/\s+/),
);
const slabs = new Set(
  `
minecraft:acacia_slab minecraft:andesite_slab minecraft:bamboo_mosaic_slab minecraft:bamboo_slab
minecraft:birch_slab minecraft:blackstone_slab minecraft:brick_slab minecraft:cherry_slab
minecraft:cinnabar_brick_slab minecraft:cinnabar_slab minecraft:cobbled_deepslate_slab minecraft:cobblestone_slab
minecraft:crimson_slab minecraft:cut_copper_slab minecraft:cut_red_sandstone_slab minecraft:cut_sandstone_slab
minecraft:dark_oak_slab minecraft:dark_prismarine_slab minecraft:deepslate_brick_slab minecraft:deepslate_tile_slab
minecraft:diorite_slab minecraft:end_stone_brick_slab minecraft:exposed_cut_copper_slab minecraft:granite_slab
minecraft:jungle_slab minecraft:mangrove_slab minecraft:mossy_cobblestone_slab minecraft:mossy_stone_brick_slab
minecraft:mud_brick_slab minecraft:nether_brick_slab minecraft:oak_slab minecraft:oxidized_cut_copper_slab
minecraft:pale_oak_slab minecraft:petrified_oak_slab minecraft:polished_andesite_slab minecraft:polished_blackstone_brick_slab
minecraft:polished_blackstone_slab minecraft:polished_cinnabar_slab minecraft:polished_deepslate_slab minecraft:polished_diorite_slab
minecraft:polished_granite_slab minecraft:polished_sulfur_slab minecraft:polished_tuff_slab minecraft:prismarine_brick_slab
minecraft:prismarine_slab minecraft:purpur_slab minecraft:quartz_slab minecraft:red_nether_brick_slab
minecraft:red_sandstone_slab minecraft:resin_brick_slab minecraft:sandstone_slab minecraft:smooth_quartz_slab
minecraft:smooth_red_sandstone_slab minecraft:smooth_sandstone_slab minecraft:smooth_stone_slab minecraft:spruce_slab
minecraft:stone_brick_slab minecraft:stone_slab minecraft:sulfur_brick_slab minecraft:sulfur_slab
minecraft:tuff_brick_slab minecraft:tuff_slab minecraft:warped_slab minecraft:waxed_cut_copper_slab
minecraft:waxed_exposed_cut_copper_slab minecraft:waxed_oxidized_cut_copper_slab minecraft:waxed_weathered_cut_copper_slab minecraft:weathered_cut_copper_slab
`
    .trim()
    .split(/\s+/),
);
const stairs = new Set(
  `
minecraft:acacia_stairs minecraft:andesite_stairs minecraft:bamboo_mosaic_stairs minecraft:bamboo_stairs
minecraft:birch_stairs minecraft:blackstone_stairs minecraft:brick_stairs minecraft:cherry_stairs
minecraft:cinnabar_brick_stairs minecraft:cinnabar_stairs minecraft:cobbled_deepslate_stairs minecraft:cobblestone_stairs
minecraft:crimson_stairs minecraft:cut_copper_stairs minecraft:dark_oak_stairs minecraft:dark_prismarine_stairs
minecraft:deepslate_brick_stairs minecraft:deepslate_tile_stairs minecraft:diorite_stairs minecraft:end_stone_brick_stairs
minecraft:exposed_cut_copper_stairs minecraft:granite_stairs minecraft:jungle_stairs minecraft:mangrove_stairs
minecraft:mossy_cobblestone_stairs minecraft:mossy_stone_brick_stairs minecraft:mud_brick_stairs minecraft:nether_brick_stairs
minecraft:oak_stairs minecraft:oxidized_cut_copper_stairs minecraft:pale_oak_stairs minecraft:polished_andesite_stairs
minecraft:polished_blackstone_brick_stairs minecraft:polished_blackstone_stairs minecraft:polished_cinnabar_stairs minecraft:polished_deepslate_stairs
minecraft:polished_diorite_stairs minecraft:polished_granite_stairs minecraft:polished_sulfur_stairs minecraft:polished_tuff_stairs
minecraft:prismarine_brick_stairs minecraft:prismarine_stairs minecraft:purpur_stairs minecraft:quartz_stairs
minecraft:red_nether_brick_stairs minecraft:red_sandstone_stairs minecraft:resin_brick_stairs minecraft:sandstone_stairs
minecraft:smooth_quartz_stairs minecraft:smooth_red_sandstone_stairs minecraft:smooth_sandstone_stairs minecraft:spruce_stairs
minecraft:stone_brick_stairs minecraft:stone_stairs minecraft:sulfur_brick_stairs minecraft:sulfur_stairs
minecraft:tuff_brick_stairs minecraft:tuff_stairs minecraft:warped_stairs minecraft:waxed_cut_copper_stairs
minecraft:waxed_exposed_cut_copper_stairs minecraft:waxed_oxidized_cut_copper_stairs minecraft:waxed_weathered_cut_copper_stairs minecraft:weathered_cut_copper_stairs
`
    .trim()
    .split(/\s+/),
);



export const STRUCTURE_ENTITY_TYPES: ReadonlySet<string> = new Set(
  [
    "armor_stand",
    "pig",
    "cow",
    "chicken",
    "creeper",
    "zombie",
    "skeleton",
    "enderman",
    "spider",
    "cave_spider",
    "allay",
    "bee",
    "sheep",
    "fox",
    "cat",
    "wolf",
    "goat",
    "iron_golem",
    "snow_golem",
    "villager",
    "drowned",
    "husk",
    "wither_skeleton",
    "stray",
    "bogged",
    "parched",
  ].map((id) => "minecraft:" + id),
);

const bindings: Record<string, [string, string]> = {
  armor_stand: ["armor_stand", "armorstand/armorstand"],
  pig: ["pig", "pig/pig_temperate"],
  cow: ["cow", "cow/cow_temperate"],
  chicken: ["chicken", "chicken/chicken_temperate"],
  creeper: ["creeper", "creeper/creeper"],
  zombie: ["zombie", "zombie/zombie"],
  skeleton: ["skeleton", "skeleton/skeleton"],
  enderman: ["enderman", "enderman/enderman"],
  spider: ["spider", "spider/spider"],
  cave_spider: ["cave_spider", "spider/cave_spider"],
  allay: ["allay", "allay/allay"],
  bee: ["bee", "bee/bee"],
  sheep: ["sheep", "sheep/sheep"],
  fox: ["fox", "fox/fox"],
  cat: ["cat", "cat/cat_tabby"],
  wolf: ["wolf", "wolf/wolf"],
  goat: ["goat", "goat/goat"],
  iron_golem: ["iron_golem", "iron_golem/iron_golem"],
  snow_golem: ["snow_golem", "snow_golem"],
  slime: ["slime", "slime/slime"],
  magma_cube: ["magma_cube", "slime/magmacube"],
  villager: ["villager", "villager/villager"],
  drowned: ["drowned", "zombie/drowned"],
  husk: ["husk", "zombie/husk"],
  wither_skeleton: ["wither_skeleton", "skeleton/wither_skeleton"],
  stray: ["stray", "skeleton/stray"],
  bogged: ["bogged", "skeleton/bogged"],
  parched: ["parched", "skeleton/parched"],
};

export type EntityAppearance = { layer: string; texture: string };

// ChestRenderer shares these three model layers across regular and copper chests.
const chestTextures: Record<string, string> = {
  chest: "normal",
  trapped_chest: "trapped",
  ender_chest: "ender",
  copper_chest: "copper",
  exposed_copper_chest: "copper_exposed",
  weathered_copper_chest: "copper_weathered",
  oxidized_copper_chest: "copper_oxidized",
  waxed_copper_chest: "copper",
  waxed_exposed_copper_chest: "copper_exposed",
  waxed_weathered_copper_chest: "copper_weathered",
  waxed_oxidized_copper_chest: "copper_oxidized",
};
export function chestAppearanceBinding(
  id: string,
  state: Record<string, string>,
): EntityAppearance | undefined {
  const name = id.startsWith("minecraft:")
    ? chestTextures[id.slice(10)]
    : undefined;
  if (!name) return undefined;
  const side =
    state.type === "left" ? "_left" : state.type === "right" ? "_right" : "";
  const layer = side
    ? `minecraft:double_chest${side}#main`
    : "minecraft:chest#main";
  const texture = `assets/minecraft/textures/entity/chest/${name}${side}.png`;
  return { layer, texture };
}
export type BlockAdapter = Readonly<{
  logical?: "bed" | "door" | "plant" | "pitcher";
  context?: "pillar" | "chain" | "lantern" | "slab" | "stairs" | "bed" | "door";
  neighbors?: "stairs";
  support?: "door" | "soil-plant" | "unknown-plant" | "lantern";
  provenance: readonly string[];
}>;
const blockAdapters = new Map<string, BlockAdapter>();
function declareBlocks(
  ids: Iterable<string>,
  declaration: Omit<BlockAdapter, "provenance">,
  provenance: string,
): void {
  for (const id of ids) {
    const previous = blockAdapters.get(id);
    blockAdapters.set(id, Object.freeze({
      ...previous,
      ...declaration,
      provenance: Object.freeze([...new Set([...(previous?.provenance ?? []), provenance])]),
    }));
  }
}
// Exact runtime declarations, not registry-tag inference or world proof.
declareBlocks(beds, { logical: "bed", context: "bed" }, "class:net.minecraft.world.level.block.BedBlock");
declareBlocks(doors, { logical: "door", context: "door", support: "door" }, "class:net.minecraft.world.level.block.DoorBlock");
declareBlocks(plants, { logical: "plant" }, "class:net.minecraft.world.level.block.DoublePlantBlock");
declareBlocks(["minecraft:pitcher_crop"], { logical: "pitcher" }, "class:net.minecraft.world.level.block.PitcherCropBlock");
declareBlocks(logs, { context: "pillar" }, "class:net.minecraft.world.level.block.RotatedPillarBlock");
declareBlocks(CONTEXT_CHAIN_IDS, { context: "chain" }, "class:net.minecraft.world.level.block.ChainBlock");
declareBlocks(lanterns, { context: "lantern" }, "class:net.minecraft.world.level.block.LanternBlock");
declareBlocks(slabs, { context: "slab" }, "class:net.minecraft.world.level.block.SlabBlock");
declareBlocks(stairs, { context: "stairs" }, "class:net.minecraft.world.level.block.StairBlock");
declareBlocks([
  "minecraft:oak_stairs", "minecraft:spruce_stairs",
  "minecraft:birch_stairs", "minecraft:stone_brick_stairs",
], { neighbors: "stairs" }, "adapter:stair-neighbors-v1");
declareBlocks([
  "minecraft:sunflower", "minecraft:lilac", "minecraft:rose_bush", "minecraft:peony",
  "minecraft:tall_grass", "minecraft:large_fern", "minecraft:pitcher_plant",
], { support: "soil-plant" }, "adapter:terrestrial-doubleplant-support-v1");
declareBlocks([
  "minecraft:tall_seagrass", "minecraft:small_dripleaf", "minecraft:pitcher_crop",
], { support: "unknown-plant" }, "adapter:special-plant-support-unknown-v1");
declareBlocks(["minecraft:lantern", "minecraft:soul_lantern"], { support: "lantern" }, "adapter:dry-lantern-support-v1");

/** An unknown ID has no specialized adapter; generic cell actions remain separate. */
export function blockAdapter(id: string): BlockAdapter | undefined {
  return blockAdapters.get(id);
}

export type EntityAppearanceBinding = Readonly<{ layer: string; texture: string }>;
export type EntityAdapter = Readonly<{
  edit?: "pig";
  structureExport: boolean;
  appearance?: EntityAppearanceBinding;
  provenance: readonly string[];
}>;
const entityAdapters = new Map<string, EntityAdapter>(
  Object.entries(bindings).map(([name, [layer, texture]]) => {
    const id = "minecraft:" + name;
    return [id, Object.freeze({
      ...(name === "pig" ? { edit: "pig" as const } : {}),
      structureExport: STRUCTURE_ENTITY_TYPES.has(id),
      appearance: Object.freeze({
        layer: "minecraft:" + layer + "#main",
        texture: "assets/minecraft/textures/entity/" + texture + ".png",
      }),
      provenance: Object.freeze([
        "class:net.minecraft.client.model.geom.LayerDefinitions",
        "adapter:static-entity-bindings-v1",
        ...(name === "pig" ? ["adapter:pig-position-yaw-v1"] : []),
        ...(STRUCTURE_ENTITY_TYPES.has(id) ? ["adapter:basic-structure-entity-v1"] : []),
      ]),
    })] as const;
  }),
);
export function entityAdapter(id: string): EntityAdapter | undefined {
  return entityAdapters.get(id);
}
