/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { gunzipSync, unzipSync } from 'fflate'
import { z } from 'zod'
import { gameProfileSchema, profileMaterials } from './profile'
import { validateState, type Material } from './catalog'
import type { BlockState } from './schema'
import { newEditorDocument, sceneBlocks } from '../editor/model'
import { createPlacedObject } from '../editor/placement'
import { rotateObjects } from '../editor/operations'
import { exportEditorStructure, preflightEditorExport } from '../io/editor-export'
import { inspectStructure } from '../io/structure-import'
import { readNbt } from '../io/nbt-reader'
import { ModelResolver } from '../render/models'
import { bakeBlock } from '../render/block-mesh'

// This is a release QA target, deliberately not an application palette filter.
const namespaced=z.string().regex(/^minecraft:[a-z0-9_]+$/)
const scope=z.object({
  schemaVersion:z.literal(1),id:z.literal('r1-candidate-1'),status:z.literal('candidate'),
  target:z.object({gameVersion:z.literal('26.2'),dataVersion:z.literal(4903)}).strict(),
  clientSha1:z.string().regex(/^[0-9a-f]{40}$/),
  purpose:z.string(),statePolicy:z.string(),
  blockGroups:z.array(z.object({role:z.string(),ids:z.array(namespaced).min(1),restrictions:z.record(z.string(),z.array(z.string()).min(1))}).strict()),
  entityCandidate:z.object({id:namespaced,scope:z.string()}).strict(),blockEntityCandidate:z.object({id:namespaced,scope:z.string()}).strict(),
  formats:z.object({document:z.string(),portable:z.string(),structureImport:z.string(),export:z.string()}).strict(),
  requiredGates:z.array(z.string()),releaseBlockers:z.array(z.object({gate:z.string(),status:z.string(),task:z.string()}).strict()),
}).strict().parse(JSON.parse(readFileSync('scripts/fixtures/r1-scope.json','utf8')))
const entries=scope.blockGroups.flatMap(group=>group.ids.map(id=>({id,restrictions:group.restrictions})))

describe('finite R1 candidate contract',()=>{
  it('keeps a finite unique palette and separate entity/payload targets',()=>{
    expect(entries).toHaveLength(29)
    expect(new Set(entries.map(entry=>entry.id)).size).toBe(entries.length)
    expect(entries.some(entry=>entry.id===scope.blockEntityCandidate.id)).toBe(false)
    expect(scope.entityCandidate.id).toBe('minecraft:pig')
    expect(scope.blockEntityCandidate.id).toBe('minecraft:chest')
  })
  it('retains the promised release gates instead of promoting a block fixture to READY',()=>{
    for(const gate of ['basic-entity-editor','typed-chest-payload','vanilla-world-readback','named-fabric-world-readback','real-hardware-performance','human-builder-acceptance']){
      expect(scope.requiredGates).toContain(gate)
      expect(scope.releaseBlockers.find(blocker=>blocker.gate===gate)?.status).toMatch(/pending|unverified/)
    }
    expect(new Set(scope.requiredGates).size).toBe(scope.requiredGates.length)
    expect(scope.releaseBlockers.every(blocker=>scope.requiredGates.includes(blocker.gate))).toBe(true)
  })
})

const profilePath='public/generated/26.2.profile.json',jarPath='public/26.2.jar'
describe.skipIf(!existsSync(profilePath)||!existsSync(jarPath))('R1 candidate against user supplied 26.2 profile/assets (not world proof)',()=>{
  let catalog:Material[],resolver:ModelResolver
  beforeAll(()=>{
    const profile=gameProfileSchema.parse(JSON.parse(readFileSync(profilePath,'utf8')))
    expect({gameVersion:profile.gameVersion,dataVersion:profile.dataVersion}).toEqual(scope.target)
    catalog=profileMaterials(profile)
    const bytes=readFileSync(jarPath)
    expect(profile.sourceSha1).toBe(scope.clientSha1)
    expect(createHash('sha1').update(bytes).digest('hex')).toBe(scope.clientSha1)
    const files=unzipSync(bytes,{filter:entry=>/^assets\/minecraft\/(blockstates\/|models\/block\/|textures\/block\/)/.test(entry.name)})
    resolver=new ModelResolver([{id:'r1-qa',name:'User supplied client',gameVersion:'26.2',priority:0,enabled:true,files,counts:{textures:0,models:0,blockstates:0,entityTextures:0}}])
  })
  function states(id:string,restrictions:Record<string,string[]>):BlockState[]{
    const material=catalog.find(entry=>entry.id===id)
    expect(material,`${id} must exist in this exact profile`).toBeDefined()
    expect(material!.hasBlockEntity).toBe(false)
    for(const [property,values] of Object.entries(restrictions)){
      expect(material!.properties[property],`${id}.${property} restriction exists`).toBeDefined()
      expect(values.every(value=>material!.properties[property].includes(value))).toBe(true)
    }
    let combinations:Record<string,string>[]=[{}]
    for(const [property,legal] of Object.entries(material!.properties)){
      const values=restrictions[property]??legal
      if(combinations.length*values.length>1024)throw new Error(`Unreviewed state scope expansion: ${id}`)
      combinations=combinations.flatMap(properties=>values.map(value=>({...properties,[property]:value})))
    }
    return combinations.map(properties=>({name:id,properties}))
  }
  it.each(entries)('$id: complete finite state domains, whole-pair yaw and file roundtrip',({id,restrictions})=>{
    for(const state of states(id,restrictions)){
      validateState(state,catalog)
      const object=createPlacedObject(state,[2,2,2],catalog,undefined,'candidate')
      const document={...newEditorDocument(),objects:[object]}
      const original=sceneBlocks(document).map(({pos,state})=>({pos,state}))
      let rotated=document
      for(let turn=0;turn<4;turn++){
        rotated=rotateObjects(rotated,['candidate'],1,'active',catalog)
        expect(preflightEditorExport(rotated,catalog).valid).toBe(true)
      }
      expect(sceneBlocks(rotated).map(({pos,state})=>({pos,state}))).toEqual(original)
      const restored=inspectStructure(readNbt(gunzipSync(exportEditorStructure(document,catalog).bytes)),id,'architecture',catalog)
      const origin=preflightEditorExport(document,catalog).origin
      expect(sceneBlocks(restored.document).map(({pos,state})=>({pos,state}))).toEqual(original.map(cell=>({...cell,pos:cell.pos.map((value,axis)=>value-origin[axis])})))
    }
  })
  it.each(entries.filter(entry=>entry.id!=='minecraft:air'))('$id: finite states resolve geometry and actual textures without fallback',({id,restrictions})=>{
    for(const state of states(id,restrictions)){
      for(const cell of createPlacedObject(state,[0,0,0],catalog,undefined,'appearance').cells){
        const resolved=resolver.resolve(cell.state,cell.pos)
        expect(resolved.warnings).toEqual([])
        const baked=bakeBlock(resolved,resolver)
        try{
          const emptyWall=id==='minecraft:cobblestone_wall'&&cell.state.properties.up==='false'&&['north','east','south','west'].every(direction=>cell.state.properties[direction]==='none')
          if(emptyWall){expect(resolved.parts).toHaveLength(0);expect(baked.geometry.getAttribute('position').count).toBe(0)}
          else {expect(baked.geometry.getAttribute('position').count).toBeGreaterThan(0);expect(baked.surfaces.length).toBeGreaterThan(0)}
          expect(baked.surfaces.every(surface=>resolver.files.has(surface.texture))).toBe(true)
        }finally{baked.geometry.dispose()}
      }
    }
  })
})
