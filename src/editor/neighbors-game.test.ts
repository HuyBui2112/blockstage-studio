import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gameProfileSchema, profileMaterials } from '../core/profile'
import { newEditorDocument, sceneBlocks, validateDocument, type EditorObject } from './model'
import { planNeighborConnections } from './neighbors'
import type { Block, Vec3 } from '../core/schema'

const profilePath='public/generated/26.2.profile.json', oraclePath='node_modules/.cache/game-profile/26.2/placement-oracle.json'
const profile=existsSync(profilePath)?gameProfileSchema.parse(JSON.parse(readFileSync(profilePath,'utf8'))):undefined
const oracle=existsSync(oraclePath)?JSON.parse(readFileSync(oraclePath,'utf8')):undefined
describe.skipIf(!profile?.neighborRules || !oracle?.neighborCases)('Minecraft 26.2 neighbor world readbacks',()=>{
  it('matches all recorded fence/wall/gate states immediately and after 20 ticks',()=>{
    expect(oracle.verifiedClientSha1).toBe(profile!.sourceSha1)
    expect(oracle.neighborCases.length).toBeGreaterThan(400)
    for(const fixture of oracle.neighborCases as {name:string;input:Block[];readback:Block[];afterTicks:Block[];ticks:number}[]){
      const empty=newEditorDocument()
      const objects:EditorObject[]=fixture.input.map((cell,i)=>({id:String(i),name:cell.state.name,kind:'block',cells:[cell],children:[],pivot2:cell.pos.map(v=>v*2+1) as Vec3,orientation:0}))
      const plan=planNeighborConnections(empty,{...empty,objects},profile!.neighborRules!)
      expect(plan.notes,fixture.name).toEqual([])
      validateDocument(plan.document,profileMaterials(profile!))
      const actual=new Map(sceneBlocks(plan.document).map(cell=>[cell.pos.join(','),cell.state]))
      expect(fixture.ticks).toBe(20)
      for(const expected of [...fixture.readback,...fixture.afterTicks])expect(actual.get(expected.pos.join(',')),`${fixture.name} ${expected.pos}`).toEqual(expected.state)
    }
  })
})
