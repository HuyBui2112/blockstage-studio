import { describe, expect, it } from 'vitest'
import type { NeighborRule, NeighborRules } from '../core/profile'
import type { Vec3 } from '../core/schema'
import { newEditorDocument, sceneBlocks, type EditorObject } from './model'
import { planNeighborConnections } from './neighbors'
import { createHistory, executeHistory, undoHistory, redoHistory } from './history'

const rule=(kind:NeighborRule['kind']='other',options:Partial<NeighborRule>={}):NeighborRule=>({kind,fence:kind==='fence',wooden:kind==='fence',wall:kind==='wall',forcePost:false,exception:false,properties:[],shapes:{'':[0,0]},...options})
const rules:NeighborRules={
  'minecraft:air':rule(), 'minecraft:stone':rule('other',{shapes:{'':[15,31]}}),
  'minecraft:oak_fence':rule('fence'), 'minecraft:birch_fence':rule('fence'), 'minecraft:nether_brick_fence':rule('fence',{wooden:false}),
  'minecraft:cobblestone_wall':rule('wall'), 'minecraft:oak_fence_gate':rule('gate'),
  'minecraft:flower_pot':rule('other',{forcePost:true}), 'minecraft:moving_piston':rule('other',{shapes:{}}),
}
function object(id:string,name:string,pos:Vec3,properties:Record<string,string>={}):EditorObject{
  const defaults=rules[`minecraft:${name}`]?.kind==='fence'?{north:'false',east:'false',south:'false',west:'false'}:rules[`minecraft:${name}`]?.kind==='wall'?{north:'none',east:'none',south:'none',west:'none',up:'true'}:rules[`minecraft:${name}`]?.kind==='gate'?{facing:'north',in_wall:'false'}:{}
  return {id,name,kind:'block',cells:[{pos,state:{name:`minecraft:${name}`,properties:{...defaults,...properties} as Record<string,string>}}],children:[],pivot2:pos.map(v=>v*2+1) as Vec3,orientation:0}
}
const doc=(...objects:EditorObject[])=>({...newEditorDocument(),objects})
const props=(document:ReturnType<typeof doc>,id:string)=>sceneBlocks(document).find(b=>b.owner===id)!.state.properties
describe('opt-in scene neighbor planning',()=>{
  it('connects both sides and disconnects after delete in one atomic history patch',()=>{
    const before=doc(object('a','oak_fence',[0,0,0])), next={...before,objects:[...before.objects,object('b','birch_fence',[1,0,0])]}
    const plan=planNeighborConnections(before,next,rules)
    expect(props(plan.document,'a').east).toBe('true');expect(props(plan.document,'b').west).toBe('true')
    expect(props(before,'a').east).toBe('false')
    const history=executeHistory(createHistory(before),plan.document,'Place and connect')
    expect(history.past).toHaveLength(1);expect(undoHistory(history).document).toEqual(before);expect(redoHistory(undoHistory(history)).document).toEqual(plan.document)
    const removed={...plan.document,objects:plan.document.objects.filter(o=>o.id!=='b')}
    expect(props(planNeighborConnections(plan.document,removed,rules).document,'a').east).toBe('false')
  })
  it('respects wooden/nether fence distinction and gate orientation',()=>{
    for(const name of ['birch_fence','nether_brick_fence']){
      const plan=planNeighborConnections(doc(),doc(object('a','oak_fence',[0,0,0]),object('b',name,[1,0,0])),rules)
      expect(props(plan.document,'a').east).toBe(String(name==='birch_fence'))
    }
    for(const facing of ['north','east']){
      const plan=planNeighborConnections(doc(),doc(object('a','oak_fence',[0,0,0]),object('g','oak_fence_gate',[1,0,0],{facing})),rules)
      expect(props(plan.document,'a').east).toBe(String(facing==='north'))
    }
  })
  it('derives wall low/tall/up and gate in_wall while retaining unrelated fields',()=>{
    const base=[object('w','cobblestone_wall',[0,0,0],{waterlogged:'true'}),object('n','stone',[0,0,-1]),object('s','stone',[0,0,1])]
    const low=planNeighborConnections(doc(),doc(...base),rules).document
    expect(props(low,'w')).toMatchObject({north:'low',south:'low',east:'none',west:'none',up:'false',waterlogged:'true'})
    const tall=planNeighborConnections(doc(),doc(...base,object('roof','stone',[0,1,0])),rules).document
    expect(props(tall,'w')).toMatchObject({north:'tall',south:'tall',up:'false'})
    expect(props(planNeighborConnections(doc(),doc(...base,object('pot','flower_pot',[0,1,0])),rules).document,'w').up).toBe('true')
    const gate=planNeighborConnections(doc(),doc(object('g','oak_fence_gate',[0,0,0],{facing:'north',open:'true'}),object('w','cobblestone_wall',[1,0,0])),rules).document
    expect(props(gate,'g')).toMatchObject({in_wall:'true',open:'true'})
  })
  it('updates nested group cells but leaves distant explicit states and all pivots/IDs intact',()=>{
    const child=object('child','oak_fence',[0,0,0]), group:EditorObject={...child,id:'group',kind:'group',cells:[],children:[child]}
    const source=doc(group,object('far','oak_fence',[100,0,0],{north:'true'}))
    const next={...source,objects:[...source.objects,object('b','stone',[1,0,0])]}
    const plan=planNeighborConnections(source,next,rules)
    expect(plan.document.objects[0].children[0]).toMatchObject({id:'child',pivot2:child.pivot2})
    expect(props(plan.document,'group').east).toBe('true')
    expect(plan.document.objects[1]).toBe(source.objects[1]);expect(props(plan.document,'far').north).toBe('true')
    expect(planNeighborConnections(plan.document,plan.document,rules).document).toBe(plan.document)
  })
  it('preserves all explicit connections with a reason if a needed shape is unknown',()=>{
    const source=doc(object('a','oak_fence',[0,0,0],{north:'true'}),object('p','moving_piston',[1,0,0]))
    const plan=planNeighborConnections(doc(),source,rules)
    expect(plan.document).toBe(source);expect(plan.notes.join(' ')).toMatch(/Dynamic.*explicit connections preserved/)
  })
})
