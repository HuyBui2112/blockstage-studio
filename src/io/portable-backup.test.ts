import { describe,it,expect } from 'vitest'
import { DEMO_MATERIALS } from '../core/catalog'
import { newEditorDocument,type EditorObject } from '../editor/model'
import { decodePortableBackup,encodePortableBackup,parsePortableBackup,planPortableRestore,reportPortableBackup,resourceManifest,type PortableBackup,type ResourceManifest } from './portable-backup'

const manifest:ResourceManifest={adapter:'blockstage-editor-v2-copy',profile:{sourceSha1:'a'.repeat(40),sha256:'b'.repeat(64)},packs:[{name:'Game.jar',fingerprint:'c'.repeat(64),enabled:true,source:'client'}]}
function fixture():PortableBackup {
  const object:EditorObject={id:'leaf',name:'Log',kind:'block',cells:[{pos:[-3,2,8],state:{name:'minecraft:oak_log',properties:{axis:'x'}}}],children:[],pivot2:[-5,5,17],orientation:1}
  return {format:'blockstage-portable',version:1,document:{...newEditorDocument(),id:'source-document',name:'Nhà mẫu',objects:[{id:'copy',name:'Column copy',kind:'component',cells:[],children:[structuredClone(object)],pivot2:[-5,5,17],orientation:0,componentId:'column'}],entities:[{id:'pig-editor',type:'minecraft:pig',position:[1.25,2,-3.5],yaw:90}]},components:[{schemaVersion:1,id:'column',name:'Column',objects:[object],pivot2:[-5,5,17],size:[1,1,1],orientation:1}],resources:structuredClone(manifest)}
}
describe('portable v1 / document v2 copy boundary',()=>{
  it('roundtrips Unicode, negative cells, explicit states, hierarchy and fractional entity data',()=>{
    const source=fixture(),frozen=structuredClone(source)
    expect(decodePortableBackup(encodePortableBackup(source))).toEqual(source)
    expect(source).toEqual(frozen)
  })
  it('allocates fresh copy IDs and remaps provenance without changing cells/pivots/states',()=>{
    const source=fixture();let next=0
    const plan=planPortableRestore(source,()=>`restored-${++next}`)
    expect(plan.document.id).not.toBe(source.document.id)
    expect(plan.document.objects[0].componentId).toBe(plan.components[0].id)
    expect(plan.document.objects[0].children[0].cells).toEqual(source.document.objects[0].children[0].cells)
    expect(plan.document.objects[0].pivot2).toEqual(source.document.objects[0].pivot2)
    expect(plan.document.entities[0]).toEqual({...source.document.entities[0],id:plan.document.entities[0].id})
    expect(plan.document.entities[0].id).not.toBe('pig-editor')
    expect(()=>planPortableRestore(source,()=> 'same')).toThrow('unique')
  })
  it('reports matching resources without requiring a source browser DB',()=>{
    const source=fixture()
    expect(reportPortableBackup(source,manifest,DEMO_MATERIALS).totalIssues).toBe(0)
    const missing=reportPortableBackup(source,{adapter:'blockstage-editor-v2-copy',profile:null,packs:[]},[])
    expect(missing.issues.join(' ')).toContain('profile is missing')
    expect(missing.issues.join(' ')).toContain('Missing or disabled pack')
    expect(missing.issues.join(' ')).toContain('Unknown block preserved')
    expect(source.document.objects[0].children[0].cells[0].state.properties.axis).toBe('x')
  })
  it('separately reports absent source definitions, profile mismatch and pack precedence',()=>{
    const source=fixture();source.components=[]
    const current=structuredClone(manifest);current.profile!.sha256='d'.repeat(64);current.packs.unshift({name:'Override',fingerprint:'e'.repeat(64),enabled:true,source:'resource'})
    const report=reportPortableBackup(source,current,DEMO_MATERIALS)
    expect(report.totalIssues).toBe(3)
    expect(report.issues.join(' ')).toContain('self-contained')
    expect(planPortableRestore(source).document.objects[0].componentId).toBe('column')
  })
  it('rejects unknown format/target/payload fields instead of stripping them',()=>{
    expect(()=>parsePortableBackup({...fixture(),version:2})).toThrow()
    expect(()=>parsePortableBackup({...fixture(),files:{'assets/texture.png':'secret'}})).toThrow()
    const source=fixture();(source.document.entities[0] as unknown as Record<string,unknown>).nbt={private:1}
    expect(()=>parsePortableBackup(source)).toThrow()
    const wrong=fixture();(wrong.document.target as unknown as Record<string,unknown>).dataVersion=1
    expect(()=>parsePortableBackup(wrong)).toThrow()
  })
  it('bounds total cells/objects, duplicate component IDs, recursive input and file bytes',()=>{
    const source=fixture();source.components.push(structuredClone(source.components[0]))
    expect(()=>parsePortableBackup(source)).toThrow('Duplicate')
    const cycle:Record<string,unknown>={};cycle.child=cycle
    expect(()=>parsePortableBackup(cycle)).toThrow('cyclic')
    const many=fixture();many.document.objects[0].children[0].cells=Array(100001).fill(many.components[0].objects[0].cells[0])
    expect(()=>parsePortableBackup(many)).toThrow('100,000')
    expect(()=>decodePortableBackup(' '.repeat(32*1024**2+1))).toThrow('32 MiB')
  })
  it('does not embed supplied pack files or use local pack IDs as resource identity',async()=>{
    const packs=[{id:'local-only',name:'Game.jar',gameVersion:'26.2',enabled:true,priority:2,fingerprint:'c'.repeat(64),source:'client' as const,files:{'assets/private.png':new Uint8Array([1,2,3])},counts:{textures:1,models:0,blockstates:0,entityTextures:0}}]
    const result=await resourceManifest(packs,null)
    expect(result.packs).toEqual(manifest.packs)
    expect(JSON.stringify(result)).not.toContain('private.png')
    expect(JSON.stringify(result)).not.toContain('local-only')
  })
})
