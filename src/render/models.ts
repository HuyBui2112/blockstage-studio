import { strFromU8 } from 'fflate'
import type { BlockState, Vec3 } from '../core/schema'
import { idSchema } from '../core/schema'
import { effectiveAssetIndex, type ResourcePack } from '../io/resources'

export type Direction = 'down' | 'up' | 'north' | 'south' | 'west' | 'east'
export type Face = { texture: string; uv?: [number, number, number, number]; rotation?: number; tintindex?: number; cullface?: Direction }
export type Element = { from: Vec3; to: Vec3; faces: Partial<Record<Direction, Face>>; shade?: boolean; rotation?: { origin: Vec3; axis?: 'x' | 'y' | 'z'; angle?: number; x?:number;y?:number;z?:number;rescale?: boolean } }
export type Model = { parent?: string; textures?: Record<string, string | {sprite:string;force_translucent?:boolean}>; elements?: Element[]; ambientocclusion?: boolean }
export type Application = { model: string; x?: number; y?: number; uvlock?: boolean; weight?: number }
export type Condition = { OR?: Condition[]; AND?: Condition[]; [property: string]: string | Condition[] | undefined }
type Blockstate = { variants?: Record<string, Application | Application[]>; multipart?: { when?: Condition; apply: Application | Application[] }[] }
export type ModelPart = { application: Application; model: Model }
export type ResolvedBlock = { key: string; parts: ModelPart[]; warnings: string[] }

export const namespaced = (id: string) => { const result = id.includes(':') ? id : `minecraft:${id}`; return idSchema.parse(result) }
export function resourcePath(kind: 'models' | 'textures' | 'blockstates', id: string) {
  const [namespace, path] = namespaced(id).split(':')
  return `assets/${namespace}/${kind}/${path}.${kind === 'textures' ? 'png' : 'json'}`
}
export function matches(condition: Condition | undefined, properties: Record<string, string>): boolean {
  if (!condition) return true
  return Object.entries(condition).every(([name, value]) => {
    if (name === 'OR') return Array.isArray(value) && value.some(c => matches(c, properties))
    if (name === 'AND') return Array.isArray(value) && value.every(c => matches(c, properties))
    if (typeof value !== 'string') return false
    const inverted = value.startsWith('!'), values = (inverted ? value.slice(1) : value).split('|')
    const match = values.includes(properties[name])
    return inverted ? properties[name] !== undefined && !match : match
  })
}
export function positionHash(pos: Vec3, salt = 0) {
  let h = Math.imul(pos[0] | 0, 73428767) ^ Math.imul(pos[1] | 0, 912931) ^ Math.imul(pos[2] | 0, 438289) ^ salt
  h = Math.imul(h ^ h >>> 16, 0x45d9f3b); return (h ^ h >>> 16) >>> 0
}
export function choose(value: Application | Application[], seed: number): Application {
  const options = Array.isArray(value) ? value : [value]
  if (!options.length || options.length > 1024) throw new Error('Invalid weighted model list')
  const weight = (v: Application) => {
    const n = v.weight ?? 1
    if (!Number.isSafeInteger(n) || n <= 0 || n > 1000000) throw new Error('Invalid model weight')
    return n
  }
  let cursor = seed % options.reduce((n, v) => n + weight(v), 0)
  for (const v of options) { cursor -= weight(v); if (cursor < 0) return v }
  return options[0]
}

/** One immutable index per enabled pack stack. Caches are never shared across stacks. */
export class ModelResolver {
  files = new Map<string, Uint8Array>()
  private jsonCache = new Map<string, unknown>()
  private modelCache = new Map<string, Model>()
  constructor(packs: ResourcePack[]) {
    this.files = effectiveAssetIndex(packs)
  }
  json<T>(path: string): T {
    if (!this.jsonCache.has(path)) {
      const bytes = this.files.get(path)
      if (!bytes) throw new Error(`Thiếu ${path}`)
      if (bytes.length > 8 * 1024 ** 2) throw new Error(`JSON quá lớn: ${path}`)
      this.jsonCache.set(path, JSON.parse(strFromU8(bytes)))
    }
    return this.jsonCache.get(path) as T
  }
  model(id: string, visiting = new Set<string>()): Model {
    id = namespaced(id)
    const cached = this.modelCache.get(id)
    if (cached) return cached
    if (visiting.has(id) || visiting.size >= 64) throw new Error(`Model parent cycle/depth: ${id}`)
    visiting.add(id)
    if (id.includes(':builtin/')) throw new Error(`Renderer đặc biệt: ${id}`)
    const own = this.json<Model>(resourcePath('models', id))
    const parent = own.parent ? this.model(own.parent, visiting) : {}
    const result = { ...parent, ...own, textures: { ...parent.textures, ...own.textures }, elements: own.elements ?? parent.elements }
    visiting.delete(id)
    this.modelCache.set(id, result)
    return result
  }
  texture(model: Model, reference: string): string {
    return this.textureInfo(model,reference).path
  }
  textureInfo(model:Model,reference:string):{path:string;translucent:boolean}{
    const seen = new Set<string>()
    let translucent=false
    if(!reference.startsWith('#')&&model.textures?.[reference]!==undefined)reference='#'+reference
    while (reference.startsWith('#')) {
      if (seen.has(reference) || seen.size >= 64) throw new Error(`Texture alias cycle: ${reference}`)
      seen.add(reference)
      const value = model.textures?.[reference.slice(1)]
      if (!value) throw new Error(`Thiếu texture alias ${reference}`)
      if(typeof value==='string')reference=value
      else {reference=value.sprite;translucent ||= value.force_translucent===true}
    }
    const path = resourcePath('textures', reference)
    if (!this.files.has(path)) throw new Error(`Thiếu ${path}`)
    return {path,translucent}
  }
  resolve(state: BlockState, pos: Vec3 = [0, 0, 0]): ResolvedBlock {
    const definition = this.json<Blockstate>(resourcePath('blockstates', state.name))
    const applications: Application[] = []
    if (definition.variants) {
      const variant = Object.entries(definition.variants).find(([key]) => !key || key.split(',').every(pair => { const [name, value] = pair.split('='); return state.properties[name] === value }))
      if (variant) applications.push(choose(variant[1], positionHash(pos)))
    }
    if (definition.multipart) {
      if (definition.multipart.length > 1024) throw new Error('Multipart quá lớn')
      definition.multipart.forEach((part, i) => { if (matches(part.when, state.properties)) applications.push(choose(part.apply, positionHash(pos, i + 1))) })
    }
    if (!applications.length && !definition.multipart) throw new Error(`Không có model cho state ${state.name}`)
    const parts = applications.map(application => {
      if (![0, 90, 180, 270].includes(application.x ?? 0) || ![0, 90, 180, 270].includes(application.y ?? 0)) throw new Error('Blockstate rotation phải là quarter-turn')
      return { application, model: this.model(application.model) }
    })
    return { key: JSON.stringify(applications), parts, warnings: [] }
  }
}
