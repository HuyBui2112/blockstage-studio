import { bounds, rotatePos } from '../core/assembly'
import { validateState, type Material } from '../core/catalog'
import type { BlockState, Vec3 } from '../core/schema'
import { newEditorDocument, objectCells, validateDocument, type ComponentAsset, type EditorObject, type QuarterTurn } from './model'
import { instantiateComponent, moveObjects, rotateObjects } from './operations'
import { createPlacedObject, isBedBlock, isDoorBlock } from './placement'

/** World-space ray hit; pos is the new cell, target is the clicked occupied cell.
 * look is the camera's forward direction, with +Z south and +X east. */
export type PlacementHit = { pos: Vec3; face: Vec3; point: Vec3; look?: Vec3; target?: Vec3 }
export type PlacementOptions = { mode: 'design' | 'context'; turns: QuarterTurn }
export type BlockPlacementPlan = { object: EditorObject; notes: string[] }

// Explicit IDs checked against 26.2 classes by PlacementOracle.java. Logs use
// RotatedPillarBlock's placement implementation; chains have a separate adapter.
// A registry tag, property or suffix is not a placement adapter.
const logs = new Set(`
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
`.trim().split(/\s+/))
// Exact 26.2 ChainBlock/LanternBlock IDs, checked by the runtime oracle. The
// shared chain set also identifies cell-face placement targets for thin meshes.
export const CONTEXT_CHAIN_IDS: ReadonlySet<string> = new Set(`
minecraft:iron_chain minecraft:copper_chain minecraft:exposed_copper_chain
minecraft:weathered_copper_chain minecraft:oxidized_copper_chain minecraft:waxed_copper_chain
minecraft:waxed_exposed_copper_chain minecraft:waxed_weathered_copper_chain minecraft:waxed_oxidized_copper_chain
`.trim().split(/\s+/))
const lanterns = new Set(`
minecraft:lantern minecraft:soul_lantern minecraft:copper_lantern minecraft:exposed_copper_lantern
minecraft:weathered_copper_lantern minecraft:oxidized_copper_lantern minecraft:waxed_copper_lantern
minecraft:waxed_exposed_copper_lantern minecraft:waxed_weathered_copper_lantern minecraft:waxed_oxidized_copper_lantern
`.trim().split(/\s+/))
const slabs = new Set(`
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
`.trim().split(/\s+/))
const stairs = new Set(`
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
`.trim().split(/\s+/))

function validTurns(turns: QuarterTurn): void {
  if (!Number.isInteger(turns) || turns < 0 || turns > 3) throw new Error('Placement yaw requires zero to three quarter turns')
}
function validHit(hit: PlacementHit, pos: Vec3): void {
  if (hit.pos.some((value, axis) => value !== pos[axis])) throw new Error('Placement hit does not match the requested cell')
  if (hit.point.some(value => !Number.isFinite(value)) || hit.face.some(value => ![-1, 0, 1].includes(value)) || hit.face.filter(value => value !== 0).length !== 1) throw new Error('Placement requires a finite hit and an axis-aligned face')
  if (hit.look?.some(value => !Number.isFinite(value))) throw new Error('Placement look must be finite')
}
function horizontalFacing(look: Vec3 | undefined): string | undefined {
  if (!look || Math.hypot(look[0], look[2]) < 1e-8) return undefined
  const yaw = Math.atan2(-look[0], look[2]) * 180 / Math.PI
  return ['south', 'west', 'north', 'east'][((Math.floor(yaw / 90 + .5) % 4) + 4) % 4]
}
function contextState(state: BlockState, pos: Vec3, hit: PlacementHit | undefined, notes: string[]): BlockState {
  const properties = { ...state.properties }, result = { name: state.name, properties }
  if (!logs.has(state.name) && !CONTEXT_CHAIN_IDS.has(state.name) && !lanterns.has(state.name) && !slabs.has(state.name) && !stairs.has(state.name) && !isBedBlock(state.name) && !isDoorBlock(state.name)) {
    notes.push('No verified Context adapter; selected state is preserved.')
    return result
  }
  if (!hit) {
    notes.push('Context needs a surface hit; selected state is preserved.')
    return result
  }
  validHit(hit, pos)
  if (logs.has(state.name) || CONTEXT_CHAIN_IDS.has(state.name)) properties.axis = hit.face[0] ? 'x' : hit.face[2] ? 'z' : 'y'
  if (CONTEXT_CHAIN_IDS.has(state.name)) notes.push('Chain fluids are not simulated.')
  if (lanterns.has(state.name)) {
    if (hit.face[1]) properties.hanging = String(hit.face[1] < 0)
    else notes.push('Lantern Context needs a top or bottom face; selected hanging state is preserved.')
    notes.push('Lantern support, alternate attachment and fluids are not simulated.')
  }
  if (slabs.has(state.name) || stairs.has(state.name)) {
    const top = hit.face[1] < 0 || (hit.face[1] === 0 && hit.point[1] - pos[1] > .5)
    properties[slabs.has(state.name) ? 'type' : 'half'] = top ? 'top' : 'bottom'
    notes.push(slabs.has(state.name) ? 'Slab merging and fluids are not simulated.' : 'Stair shape, neighbors and fluids are not simulated.')
  }
  if (stairs.has(state.name) || isBedBlock(state.name) || isDoorBlock(state.name)) {
    const facing = horizontalFacing(hit.look)
    if (facing) properties.facing = facing
    else notes.push('Horizontal camera direction unavailable; selected facing is preserved.')
  }
  if (isBedBlock(state.name)) notes.push('Bed occupancy and neighbor updates are not simulated.')
  if (isDoorBlock(state.name)) notes.push('Door hinge, open state and power remain explicit; neighbors and power are not simulated.')
  return result
}

/** One plan supplies both the ghost and the atomic insertion. Context derives
 * only verified orientation/half fields; explicit remaining properties survive. */
export function planBlockPlacement(state: BlockState, pos: Vec3, catalog: Material[], hit: PlacementHit | undefined, options: PlacementOptions): BlockPlacementPlan {
  validTurns(options.turns)
  validateState(state, catalog)
  const notes: string[] = []
  const source = options.mode === 'context' ? contextState(state, pos, hit, notes) : state
  let object = createPlacedObject(source, pos, catalog)
  if (options.turns) {
    const document = { ...newEditorDocument(), objects: [object] }
    object = rotateObjects(document, [object.id], options.turns, 'active', catalog).objects[0]
  }
  return { object, notes }
}

/** Yaw around an integer cell center, then anchor rotated minimum bounds at pos.
 * This permits non-square footprints without rounding mixed-parity pivots.
 * The saved pivot and every child pivot rotate with the cells and states. */
export function planComponentPlacement(asset: ComponentAsset, pos: Vec3, turns: QuarterTurn, catalog: Material[]): EditorObject {
  validTurns(turns)
  let object = instantiateComponent(asset, [0, 0, 0])
  const anchor = objectCells(object)[0]?.pos
  if (!anchor) throw new Error('A placed component must contain cells')
  const pivot2 = anchor.map(value => value * 2 + 1) as Vec3
  const savedPivot = [...object.pivot2] as Vec3
  let document = { ...newEditorDocument(), objects: [{ ...object, pivot2 }] }
  if (turns) document = rotateObjects(document, [object.id], turns, 'active', catalog)
  object = document.objects[0]
  const rotatedPivot = rotatePos(savedPivot.map((value, axis) => value - pivot2[axis]) as Vec3, turns).map((value, axis) => value + pivot2[axis]) as Vec3
  document = { ...document, objects: [{ ...object, pivot2: rotatedPivot }] }
  const box = bounds(objectCells(object))
  const delta = pos.map((value, axis) => value - box.min[axis]) as Vec3
  document = moveObjects(document, [object.id], delta, 'global', catalog)
  validateDocument(document, catalog)
  return document.objects[0]
}
