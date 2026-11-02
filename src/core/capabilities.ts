import { validateState, type Material } from './catalog'
import type { BlockState } from './schema'

/** Finite editor replacement contract, not an appearance or world-behavior claim. */
export type ReplacementCapability = Readonly<{
  supported:boolean;reason:string;family?:string;evidence:readonly string[]
}>
const woods='oak spruce birch jungle acacia cherry dark_oak pale_oak mangrove bamboo crimson warped'.split(' ')
const colors='white orange magenta light_blue yellow lime pink gray light_gray cyan purple blue brown green red black'.split(' ')
const stones='stone cobblestone mossy_cobblestone stone_brick mossy_stone_brick brick mud_brick sandstone smooth_sandstone cut_sandstone red_sandstone smooth_red_sandstone cut_red_sandstone granite polished_granite diorite polished_diorite andesite polished_andesite deepslate_brick deepslate_tile cobbled_deepslate polished_deepslate blackstone polished_blackstone polished_blackstone_brick tuff polished_tuff tuff_brick nether_brick red_nether_brick quartz smooth_quartz purpur end_stone_brick'.split(' ')
const ids=(names:readonly string[])=>names.map(name=>`minecraft:${name}`)
const families:ReadonlyArray<readonly [string,readonly string[]]>=[
  ['pillar',ids(woods.filter(wood=>!['bamboo','crimson','warped'].includes(wood)).flatMap(wood=>[`${wood}_log`,`${wood}_wood`,`stripped_${wood}_log`,`stripped_${wood}_wood`]).concat(['crimson_stem','warped_stem','crimson_hyphae','warped_hyphae','stripped_crimson_stem','stripped_warped_stem','stripped_crimson_hyphae','stripped_warped_hyphae','bamboo_block','stripped_bamboo_block']))],
  ['planks',ids(woods.map(wood=>`${wood}_planks`))],
  ['slab',ids([...woods,...stones,'bamboo_mosaic'].map(name=>`${name}_slab`))],
  ['stairs',ids([...woods,...stones,'bamboo_mosaic'].map(name=>`${name}_stairs`))],
  ['door',ids(woods.map(wood=>`${wood}_door`).concat(['iron_door','copper_door','exposed_copper_door','weathered_copper_door','oxidized_copper_door','waxed_copper_door','waxed_exposed_copper_door','waxed_weathered_copper_door','waxed_oxidized_copper_door']))],
  ['bed',ids(colors.map(color=>`${color}_bed`))],
  ['masonry',ids(['stone','cobblestone','mossy_cobblestone','stone_bricks','mossy_stone_bricks','cracked_stone_bricks','chiseled_stone_bricks','bricks','mud_bricks','granite','polished_granite','diorite','polished_diorite','andesite','polished_andesite','deepslate_bricks','deepslate_tiles','cobbled_deepslate','polished_deepslate','blackstone','polished_blackstone','polished_blackstone_bricks','tuff','polished_tuff','tuff_bricks','end_stone_bricks','nether_bricks','red_nether_bricks'])],
]
const replacementFamilies=new Map(families.flatMap(([family,names])=>names.map(id=>[id,family] as const)))

/** Exact IDs + identical property domains; tags, labels and suffixes grant no permission. */
export function replacementCompatibility(state:BlockState,targetId:string,catalog:readonly Material[]):ReplacementCapability {
  return createReplacementResolver(catalog)(state,targetId)
}

/** One registry index per operation/panel, including catalogs with thousands of IDs. */
export function createReplacementResolver(catalog:readonly Material[]) {
  const registry=new Map(catalog.map(material=>[material.id,material]))
  return (state:BlockState,targetId:string):ReplacementCapability=>{
  const evidence=['editor-contract:replacement-v1','validation:exact-property-domains','world-readback:unverified'] as const
  const fail=(reason:string):ReplacementCapability=>({supported:false,reason,evidence})
  const source=registry.get(state.name),target=registry.get(targetId)
  if(!source||!target)return fail('Source or target registry is unavailable')
  try{validateState(state,[source])}catch{return fail('Source block state is invalid')}
  if(state.name===targetId)return fail('Source and target material are identical')
  const family=replacementFamilies.get(state.name)
  if(!family||family!==replacementFamilies.get(targetId))return fail('No verified editor replacement contract for this material pair')
  const properties=Object.keys(source.properties)
  if(properties.length!==Object.keys(target.properties).length||properties.some(property=>{
    const values=source.properties[property],other=target.properties[property]
    return !other||values.length!==other.length||values.some(value=>!other.includes(value))
  }))return fail('Property domains differ; replacement cannot preserve the full state contract')
  try{validateState({name:targetId,properties:state.properties},[target])}catch{return fail('Target does not accept every source property value')}
  return {supported:true,reason:'Preserves every property and occupied cell; world behavior is unverified',family,evidence}
  }
}
