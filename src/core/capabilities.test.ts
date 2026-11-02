import { describe,expect,it } from 'vitest'
import { DEMO_MATERIALS,defaultState,type Material } from './catalog'
import { replacementCompatibility } from './capabilities'

describe('finite material replacement capabilities',()=>{
  it('preserves each log axis and separates editor evidence from game proof',()=>{
    for(const axis of ['x','y','z']){
      const result=replacementCompatibility({name:'minecraft:oak_log',properties:{axis}},'minecraft:spruce_log',DEMO_MATERIALS)
      expect(result.supported).toBe(true)
      expect(result.family).toBe('pillar')
      expect(result.evidence).toContain('world-readback:unverified')
    }
  })
  it('does not grant compatibility from tags, family labels, property spelling or suffixes',()=>{
    const fake:Material={...DEMO_MATERIALS[0],id:'mod:oak_log',family:'logs',tags:['minecraft:logs']}
    expect(replacementCompatibility(defaultState(fake.id,[fake]),'minecraft:oak_log',[...DEMO_MATERIALS,fake]).supported).toBe(false)
    expect(replacementCompatibility(defaultState('minecraft:oak_log'),'minecraft:oak_stairs',DEMO_MATERIALS).supported).toBe(false)
    expect(replacementCompatibility(defaultState('minecraft:oak_planks'),'minecraft:stone',DEMO_MATERIALS).supported).toBe(false)
  })
  it('rejects property additions/removals and differing domains even when current value fits',()=>{
    const state=defaultState('minecraft:oak_log')
    const domains:Record<string,string[]>[]=[{},{axis:['x','y']},{axis:['x','y','z'],waterlogged:['true','false']}]
    for(const properties of domains){
      const catalog=DEMO_MATERIALS.map(m=>m.id==='minecraft:spruce_log'?{...m,properties}:m)
      expect(replacementCompatibility(state,'minecraft:spruce_log',catalog).supported).toBe(false)
    }
    expect(replacementCompatibility({...state,properties:{axis:'bad'}},'minecraft:spruce_log',DEMO_MATERIALS).supported).toBe(false)
    expect(replacementCompatibility({...state,properties:{axis:'y',unknown:'true'}},'minecraft:spruce_log',DEMO_MATERIALS).supported).toBe(false)
  })
  it('reports missing registry and identical material without fake defaults',()=>{
    expect(replacementCompatibility(defaultState('minecraft:oak_log'),'minecraft:spruce_log',[]).reason).toMatch(/unavailable/)
    expect(replacementCompatibility(defaultState('minecraft:oak_log'),'minecraft:oak_log',DEMO_MATERIALS).reason).toMatch(/identical/)
  })
})
