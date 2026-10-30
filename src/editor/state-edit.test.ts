import { describe, expect, it } from 'vitest'
import { DEMO_MATERIALS, defaultState, type Material } from '../core/catalog'
import type { Vec3 } from '../core/schema'
import { newEditorDocument, type EditorObject } from './model'
import { createPlacedObject } from './placement'
import { sharedStateFields } from './state-edit'
import { groupObjects, updateObjectsState } from './operations'
import { createHistory, executeHistory, redoHistory, undoHistory } from './history'

const material = (id: string, properties: Record<string, string[]>, defaults: Record<string, string>): Material => ({ id: `minecraft:${id}`, label: id, family: 'fixture', color: '#888', properties, defaults })
const catalog = [...DEMO_MATERIALS,
  material('red_bed', { facing: ['north','east','south','west'], part: ['foot','head'], occupied: ['false','true'] }, { facing:'north',part:'foot',occupied:'false' }),
  material('oak_door', { facing:['north','east','south','west'], half:['upper','lower'], open:['true','false'] }, { facing:'north',half:'lower',open:'false' }),
  material('pitcher_crop', { age:['0','1','2','3','4'], half:['upper','lower'] }, { age:'0',half:'lower' }),
  material('furnace', { facing:['north','east','south','west'], lit:['true','false'] }, { facing:'north',lit:'false' }),
  material('dispenser', { facing:['up','down','north','east','south','west'], triggered:['true','false'] }, { facing:'up',triggered:'true' }),
  material('unknown_a', { mode:['left','right'] }, { mode:'left' }),
  material('unknown_b', { mode:['left','right'] }, { mode:'right' }),
]
function object(id: string, name = 'oak_log', pos: Vec3 = [0,0,0], props: Record<string, string> = {}): EditorObject {
  const state = defaultState(`minecraft:${name}`, catalog)
  return { ...createPlacedObject({ ...state, properties:{...state.properties,...props} },pos,catalog), id }
}
const doc = (...objects: EditorObject[]) => ({ ...newEditorDocument(), objects })
const fields = (...objects: EditorObject[]) => sharedStateFields(objects,catalog).fields

describe('shared block state editing', () => {
  it('exposes same-ID fields with Mixed and keeps unedited properties per object', () => {
    const a = object('a','oak_stairs',[0,0,0],{facing:'north',shape:'inner_left'}), b = object('b','oak_stairs',[3,0,0],{facing:'west',half:'top'})
    expect(fields(a,b).find(f=>f.property==='facing')?.value).toBeNull()
    const source = doc(a,b), before = structuredClone(source)
    const next = updateObjectsState(source,['a','b'],'facing','east',catalog)
    expect(next.objects.map(o=>o.cells[0].state.properties.facing)).toEqual(['east','east'])
    expect(next.objects[0].cells[0].state.properties.shape).toBe('inner_left')
    expect(next.objects[1].cells[0].state.properties.half).toBe('top')
    expect(source).toEqual(before)
  })
  it('shares axis across log IDs and excludes incompatible/unknown cross-ID semantics', () => {
    expect(fields(object('a'),object('b','birch_log',[2,0,0],{axis:'x'}))).toEqual([{property:'axis',values:['x','y','z'],value:null}])
    expect(fields(object('a','unknown_a'),object('b','unknown_b',[2,0,0]))).toEqual([])
    expect(fields(object('a','unknown_a'),object('b','unknown_a',[2,0,0]))[0].property).toBe('mode')
    expect(fields(object('a'),object('b','stone',[2,0,0]))).toEqual([])
  })
  it('intersects legal facing values and does not leak other active-object fields', () => {
    const source = doc(object('a','furnace'),object('b','dispenser',[2,0,0]))
    expect(fields(...source.objects)).toEqual([{property:'facing',values:['north','east','south','west'],value:null}])
    expect(()=>updateObjectsState(source,['a','b'],'facing','up',catalog)).toThrow(/compatible/)
    expect(()=>updateObjectsState(source,['a','b'],'lit','true',catalog)).toThrow(/compatible/)
    expect(updateObjectsState(source,['a','b'],'facing','south',catalog).objects[1].cells[0].state.properties.triggered).toBe('true')
  })
  it('represents mixed booleans without treating them as false', () => {
    const a=object('a','oak_stairs'), b=object('b','oak_stairs',[2,0,0],{waterlogged:'true'})
    expect(fields(a,b).find(f=>f.property==='waterlogged')?.value).toBeNull()
    expect(updateObjectsState(doc(a,b),['a','b'],'waterlogged','false',catalog).objects.every(o=>o.cells[0].state.properties.waterlogged==='false')).toBe(true)
  })
  it('does not flatten a group or component, or silently skip one selected object', () => {
    const source=doc(object('a'),object('b','oak_log',[2,0,0]),object('c','oak_log',[4,0,0]))
    const grouped=groupObjects(source,['a','b'],'Logs',catalog), group=grouped.objects.find(o=>o.kind==='group')!
    for(const kind of ['group','component'] as const){
      const scoped={...group,kind}
      expect(sharedStateFields([source.objects[2],scoped],catalog)).toMatchObject({fields:[],reason:expect.stringMatching(/scope/)})
      expect(()=>updateObjectsState(doc(source.objects[2],scoped),['c',scoped.id],'axis','z',catalog)).toThrow(/scope/)
    }
  })
  it('rejects duplicate, missing, empty and unsupported selections without mutation', () => {
    const source=doc(object('a')), before=structuredClone(source)
    for(const ids of [[],['a','a'],['missing']]) expect(()=>updateObjectsState(source,ids,'axis','x',catalog)).toThrow()
    expect(()=>updateObjectsState(source,['a'],'axis','invalid',catalog)).toThrow()
    expect(sharedStateFields(source.objects,[]).reason).toMatch(/Registry/)
    expect(source).toEqual(before)
  })
  it('hides structural parts of beds, doors and young pitcher crops, while keeping stair half', () => {
    for(const name of ['red_bed','oak_door','pitcher_crop']) {
      const a=object('a',name), b=object('b',name,[4,0,0])
      expect(fields(a,b).some(f=>['half','part'].includes(f.property))).toBe(false)
      expect(()=>updateObjectsState(doc(a,b),['a','b'],name==='red_bed'?'part':'half',name==='red_bed'?'head':'upper',catalog)).toThrow(/whole/)
    }
    expect(fields(object('a','oak_stairs'),object('b','oak_stairs',[2,0,0])).some(f=>f.property==='half')).toBe(true)
    expect(fields(object('a','oak_stairs'),object('b','oak_door',[2,0,0])).some(f=>f.property==='half')).toBe(false)
  })
  it('rewrites beds against the final batch occupancy, permitting vacated cells', () => {
    const a=object('a','red_bed',[0,0,0]), b=object('b','red_bed',[1,0,-1],{facing:'south'})
    const source=doc(a,b)
    const next=updateObjectsState(source,['a','b'],'facing','east',catalog)
    expect(next.objects.map(o=>o.cells.map(c=>c.pos))).toEqual([[[0,0,0],[1,0,0]],[[1,0,-1],[2,0,-1]]])
    expect(next.objects.map(o=>o.pivot2)).toEqual(source.objects.map(o=>o.pivot2))
    expect(next.objects.every(o=>o.cells.map(c=>c.state.properties.part).join(',')==='foot,head')).toBe(true)
  })
  it('rejects the entire bed batch for collisions with selected and unselected cells', () => {
    for(const source of [doc(object('a','red_bed'),object('b','red_bed',[1,0,0])),doc(object('a','red_bed'),object('b','red_bed',[3,0,0]),object('wall','stone',[4,0,0]))]) {
      const before=structuredClone(source)
      expect(()=>updateObjectsState(source,['a','b'],'facing','east',catalog)).toThrow(/collision/i)
      expect(source).toEqual(before)
    }
  })
  it('grows/shrinks each pitcher pair together and validates the whole footprint', () => {
    const source=doc(object('a','pitcher_crop'),object('b','pitcher_crop',[3,0,0]))
    const grown=updateObjectsState(source,['a','b'],'age','3',catalog)
    expect(grown.objects.map(o=>[o.kind,o.cells.length])).toEqual([['multiblock',2],['multiblock',2]])
    expect(updateObjectsState(grown,['a','b'],'age','1',catalog).objects.every(o=>o.kind==='block'&&o.cells.length===1)).toBe(true)
    expect(()=>updateObjectsState({...source,objects:[...source.objects,object('roof','stone',[3,1,0])]},['a','b'],'age','3',catalog)).toThrow(/collision/i)
  })
  it('uses one undo/redo entry and retains redo on a no-op state edit', () => {
    const source=doc(object('a'),object('b','oak_log',[2,0,0],{axis:'x'}))
    const initial=createHistory(source), next=updateObjectsState(initial.document,['a','b'],'axis','z',catalog)
    const history=executeHistory(initial,next,'Change block state')
    expect(history.past).toHaveLength(1)
    expect(undoHistory(history).document).toEqual(source)
    expect(redoHistory(undoHistory(history)).document).toEqual(next)
    const undone=undoHistory(history)
    expect(executeHistory(undone,updateObjectsState(undone.document,['a'],'axis','y',catalog),'No-op')).toBe(undone)
  })
})
