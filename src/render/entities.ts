import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three'
import type { EntityModelPart, GameProfile } from '../core/profile'
import type { BakedMesh } from './block-mesh'
import type { ModelResolver } from './models'

export type EntityAppearance = { layer: string; texture: string }
// Explicit 26.2 bindings. Geometry itself is baked by the game's LayerDefinitions.
const bindings: Record<string, [string,string]> = {
  armor_stand: ['armor_stand','armorstand/armorstand'], pig: ['pig','pig/pig_temperate'], cow: ['cow','cow/cow_temperate'], chicken: ['chicken','chicken/chicken_temperate'],
  creeper: ['creeper','creeper/creeper'], zombie: ['zombie','zombie/zombie'], skeleton: ['skeleton','skeleton/skeleton'], enderman: ['enderman','enderman/enderman'],
  spider: ['spider','spider/spider'], cave_spider: ['cave_spider','spider/cave_spider'], allay: ['allay','allay/allay'], bee: ['bee','bee/bee'],
  sheep: ['sheep','sheep/sheep'], fox: ['fox','fox/fox'], cat: ['cat','cat/cat_tabby'], wolf: ['wolf','wolf/wolf'],
  goat: ['goat','goat/goat'], iron_golem: ['iron_golem','iron_golem/iron_golem'], snow_golem: ['snow_golem','snow_golem'],
  slime: ['slime','slime/slime'], magma_cube: ['magma_cube','slime/magmacube'], villager: ['villager','villager/villager'],
  drowned: ['drowned','zombie/drowned'], husk: ['husk','zombie/husk'], wither_skeleton: ['wither_skeleton','skeleton/wither_skeleton'],
  stray: ['stray','skeleton/stray'], bogged: ['bogged','skeleton/bogged'], parched: ['parched','skeleton/parched'],
}
export function entityAppearance(id: string, profile: GameProfile | null, resolver: ModelResolver): EntityAppearance | undefined {
  const binding = id.startsWith('minecraft:') ? bindings[id.slice(10)] : undefined
  if (!binding) return undefined
  const layer = `minecraft:${binding[0]}#main`, texture = `assets/minecraft/textures/entity/${binding[1]}.png`
  return profile?.entityModels[layer] && resolver.files.has(texture) ? { layer, texture } : undefined
}
export function bakeEntity(root: EntityModelPart, texture: string, space: 'entity' | 'block' = 'entity'): BakedMesh {
  const positions: number[] = [], uvs: number[] = []
  let omitted = 0, partCount = 0
  function visit(part: EntityModelPart, parent: Matrix4, depth: number) {
    if (depth > 64 || ++partCount > 4096) throw new Error('Entity hierarchy quá lớn')
    omitted += part.omittedPolygons
    const transform = parent.clone().multiply(new Matrix4().compose(new Vector3(...part.position).multiplyScalar(1/16), new Quaternion().setFromEuler(new Euler(...part.rotation,'ZYX')), new Vector3(...part.scale)))
    for (const polygon of part.polygons) for (const n of [0,1,2,0,2,3]) {
      const [x,y,z,u,v] = polygon[n], p = new Vector3(x/16,y/16,z/16).applyMatrix4(transform)
      positions.push(p.x,p.y,p.z); uvs.push(u,1-v)
    }
    for (const child of Object.values(part.children)) visit(child,transform,depth+1)
  }
  const base = space === 'entity' ? new Matrix4().makeTranslation(0,1.5,0).multiply(new Matrix4().makeScale(1,-1,-1)) : new Matrix4().makeTranslation(-.5,-.5,-.5)
  visit(root,base,0)
  if (omitted) throw new Error(`Model có ${omitted} polygon UV không hợp lệ; cần adapter riêng`)
  if (!positions.length) throw new Error('Model entity không có geometry')
  const geometry = new BufferGeometry()
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3)); geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2)); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometry.addGroup(0,positions.length/3,0)
  return { geometry, surfaces: [{texture,tint:false,shade:true}] }
}

// ChestRenderer shares these three model layers across regular and copper chests.
const chestTextures: Record<string,string> = {
  chest:'normal', trapped_chest:'trapped', ender_chest:'ender',
  copper_chest:'copper', exposed_copper_chest:'copper_exposed', weathered_copper_chest:'copper_weathered', oxidized_copper_chest:'copper_oxidized',
  waxed_copper_chest:'copper', waxed_exposed_copper_chest:'copper_exposed', waxed_weathered_copper_chest:'copper_weathered', waxed_oxidized_copper_chest:'copper_oxidized',
}
export function blockEntityAppearance(id: string, state: Record<string,string>): EntityAppearance | undefined {
  const name = id.startsWith('minecraft:') ? chestTextures[id.slice(10)] : undefined
  if (!name) return undefined
  const side = state.type === 'left' ? '_left' : state.type === 'right' ? '_right' : ''
  const layer = side ? `minecraft:double_chest${side}#main` : 'minecraft:chest#main'
  const texture = `assets/minecraft/textures/entity/chest/${name}${side}.png`
  return {layer,texture}
}
