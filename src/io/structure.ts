import { gzipSync, strToU8, zipSync } from 'fflate'
import { flatten, bounds } from '../core/assembly'
import { blockSchema, entitySchema, stateKey, uniqueBlocks, type Block, type BlockState, type Project, type SceneEntity, type Vec3 } from '../core/schema'
import { DEMO_MATERIALS, validateState, type Material } from '../core/catalog'

type Tag = { type: 3 | 5 | 6; value: number } | { type: 8; value: string } | { type: 9; element: number; value: Tag[] } | { type: 10; value: Record<string, Tag> }
const int = (value: number): Tag => ({ type: 3, value })
const string = (value: string): Tag => ({ type: 8, value })
const list = (element: number, value: Tag[]): Tag => ({ type: 9, element, value })
const compound = (value: Record<string, Tag>): Tag => ({ type: 10, value })
// Java Edition uses named, big-endian NBT; this encoder intentionally only writes structure tags.
export function encodeNbt(root: Tag): Uint8Array {
  const out: number[] = []
  const number = (n: number, bytes: number) => { for (let i = bytes - 1; i >= 0; i--) out.push((n >>> (i * 8)) & 255) }
  const text = (s: string) => { const b = strToU8(s); if (b.length > 65535) throw new Error('NBT string quá dài'); number(b.length, 2); out.push(...b) }
  const payload = (tag: Tag) => {
    switch (tag.type) {
      case 3: number(tag.value, 4); break
      case 5: case 6: {
        const bytes=new Uint8Array(tag.type===5?4:8),view=new DataView(bytes.buffer)
        if(tag.type===5)view.setFloat32(0,tag.value);else view.setFloat64(0,tag.value)
        out.push(...bytes);break
      }
      case 8: text(tag.value); break
      case 9: out.push(tag.element); number(tag.value.length, 4); for (const t of tag.value) payload(t); break
      case 10: for (const [name, child] of Object.entries(tag.value)) { out.push(child.type); text(name); payload(child) }; out.push(0); break
    }
  }
  out.push(root.type); text(''); payload(root)
  return new Uint8Array(out)
}
/** An explicit committed scene, shared by the legacy and editor document adapters. */
export type StructureScene = {
  name: string
  target: { gameVersion: string; dataVersion: number }
  blocks: Block[]
  entities: SceneEntity[]
}

export const STRUCTURE_ENTITY_TYPES: ReadonlySet<string> = new Set(['armor_stand','pig','cow','chicken','creeper','zombie','skeleton','enderman','spider','cave_spider','allay','bee','sheep','fox','cat','wolf','goat','iron_golem','snow_golem','villager','drowned','husk','wither_skeleton','stray','bogged','parched'].map(id=>'minecraft:'+id))
const demoMaterials = new Map(DEMO_MATERIALS.map(material => [material.id, material]))

/** A resource-pack catalog alone is not evidence of a legal game blockstate. */
export function structureStateError(state: BlockState, materials: ReadonlyMap<string, Material>): string | undefined {
  const material = materials.get(state.name)
  if (!demoMaterials.has(state.name) && material?.source !== 'game-profile') return `${state.name}: chưa có adapter/profile game để xác nhận xuất`
  if (material?.hasBlockEntity) return `${state.name}: cần payload block entity; chưa hỗ trợ xuất trong bản này`
  try {
    validateState(state, material ? [material] : [])
    // The built-in fallback verifies its own finite states, never arbitrary pack metadata.
    if (material?.source !== 'game-profile') validateState(state, [demoMaterials.get(state.name)!])
  } catch (error) { return error instanceof Error ? error.message : 'Invalid blockstate' }
}

export function exportStructureScene(scene: StructureScene, catalog: Material[]) {
  if (scene.target.gameVersion !== '26.2' || scene.target.dataVersion !== 4903) throw new Error('Structure export requires Minecraft Java 26.2 / DataVersion 4903')
  const blocks = scene.blocks.map(block => blockSchema.parse(block))
  const entities = scene.entities.map(entity => entitySchema.parse(entity))
  uniqueBlocks(blocks)
  if (!blocks.length&&!entities.length) throw new Error('Công trình chưa có block/entity')
  const { min, size } = bounds([...blocks,...entities.map(e=>({pos:e.position.map(Math.floor) as Vec3}))])
  // Vanilla structure-block UI limit. Larger exports belong in a schematic adapter.
  if (size.some(v => v > 48)) throw new Error('Structure NBT bản nền giới hạn 48 block mỗi chiều; chia công trình thành nhiều phần')
  const palette: Tag[] = [], states = new Map<string, number>(), materials = new Map(catalog.map(material => [material.id, material]))
  const result = blocks.map(b => {
    const error = structureStateError(b.state, materials)
    if (error) throw new Error(error)
    const k = stateKey(b.state)
    if (!states.has(k)) {
      states.set(k, palette.length)
      palette.push(compound({ Name: string(b.state.name), ...(Object.keys(b.state.properties).length ? { Properties: compound(Object.fromEntries(Object.entries(b.state.properties).map(([k, v]) => [k, string(v)]))) } : {}) }))
    }
    return compound({ pos: list(3, b.pos.map((v, n) => int(v - min[n]))), state: int(states.get(k)!) })
  })
  const entityTags=entities.map(e=>{
    if(!STRUCTURE_ENTITY_TYPES.has(e.type))throw new Error(`${e.type}: chưa hỗ trợ xuất dữ liệu entity loại này`)
    const pos=e.position.map((v,i)=>v-min[i])
    return compound({pos:list(6,pos.map(value=>({type:6,value}))),blockPos:list(3,pos.map(v=>int(Math.floor(v)))),nbt:compound({id:string(e.type),Pos:list(6,pos.map(value=>({type:6,value}))),Rotation:list(5,[{type:5,value:e.yaw},{type:5,value:0}])})})
  })
  const root = compound({ DataVersion: int(scene.target.dataVersion), size: list(3, size.map(int)), palette: list(10, palette), blocks: list(10, result), entities: list(10, entityTags) })
  return { bytes: gzipSync(encodeNbt(root)), origin: min as Vec3, count: blocks.length }
}
export function exportDatapackScene(scene: StructureScene, catalog: Material[]) {
  const structure = exportStructureScene(scene, catalog)
  return zipSync({
    'pack.mcmeta': strToU8(JSON.stringify({ pack: { description: `Blockstage: ${scene.name}`, min_format: [107, 1], max_format: [107, 1] } })),
    'data/blockstage/structure/build.nbt': structure.bytes,
    'README.txt': strToU8(`Minecraft Java 26.2 / DataVersion 4903\nCopy this ZIP into <world>/datapacks, then /reload.\n/place template blockstage:build ~ ~ ~\nRequires commands enabled. Test in a separate Creative world.\nAll Blockstage ZIPs use blockstage:build; enable only one to avoid overrides.\nOriginal editor minimum: ${structure.origin.join(', ')}. Export normalized to 0,0,0.\nOnly explicit cells are included; empty cells leave the destination unchanged. Explicit air cells clear their destination.\nDesign placement only: support, neighbors, fluids, redstone and ticks are not simulated by the editor. Minecraft may update states.\nA supported fixture passed vanilla 26.2 world readback; arbitrary designs and Fabric/modded behavior still require testing.\n`),
  })
}

function legacyScene(project: Project): StructureScene {
  return { name: project.name, target: project.target, blocks: flatten(project).map(({ pos, state }) => ({ pos, state })), entities: project.entities ?? [] }
}
export function exportStructure(project: Project, catalog: Material[]) {
  return exportStructureScene(legacyScene(project), catalog)
}
export function exportDatapack(project: Project, catalog: Material[]) {
  return exportDatapackScene(legacyScene(project), catalog)
}
