import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createServer} from 'vite'
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'})
try{
 const {parsePack}=await server.ssrLoadModule('/src/io/archive.ts')
 const {ModelResolver}=await server.ssrLoadModule('/src/render/models.ts')
 const {bakeBlock}=await server.ssrLoadModule('/src/render/block-mesh.ts')
 const {gameProfileSchema}=await server.ssrLoadModule('/src/core/profile.ts')
 const {entityAppearance,bakeEntity,blockEntityAppearance}=await server.ssrLoadModule('/src/render/entities.ts')
 const profile=gameProfileSchema.parse(JSON.parse(await readFile('public/generated/26.2.profile.json','utf8')))
 const resolver=new ModelResolver([parsePack(await readFile(process.argv[2]??'public/26.2.jar'),'26.2.jar')])
 const failures=new Map(), baked=new Set();let states=0,models=0,empty=0
 const start=performance.now()
 for(const b of profile.blocks){
  if(b.renderShape==='INVISIBLE')continue
  const entries=Object.entries(b.properties)
  function visit(properties,i){
   if(i<entries.length){const [name,values]=entries[i];for(const value of values)visit({...properties,[name]:value},i+1);return}
   states++
   try{
    const special=blockEntityAppearance(b.id,properties)
    if(special&&profile.entityModels[special.layer]){
      if(!resolver.files.has(special.texture))throw new Error('Missing special texture: '+special.texture)
      const id='special:'+JSON.stringify(special)
      if(!baked.has(id)){
        const mesh=bakeEntity(profile.entityModels[special.layer],special.texture,'block')
        for(const key of ['position','uv','normal'])if(!Array.from(mesh.geometry.getAttribute(key).array).every(Number.isFinite))throw new Error('Nonfinite '+key)
        mesh.geometry.dispose();baked.add(id);models++
      }
      return
    }
    const resolved=resolver.resolve({name:b.id,properties},[0,0,0])
    if(baked.has(resolved.key))return
    const mesh=bakeBlock(resolved,resolver,!b.hasBlockEntity)
    for(const key of ['position','uv','normal'])if(!Array.from(mesh.geometry.getAttribute(key).array).every(Number.isFinite))throw new Error('Nonfinite '+key)
    if(!mesh.geometry.getAttribute('position').count)empty++
    mesh.geometry.dispose();baked.add(resolved.key);models++
   }catch(error){const entry=failures.get(b.id)??{id:b.id,count:0,message:error.message,example:properties};entry.count++;failures.set(b.id,entry)}
  }
  visit({},0)
 }
 const entities=[]
 for(const e of profile.entities){const a=entityAppearance(e.id,profile,resolver);if(a){try{const mesh=bakeEntity(profile.entityModels[a.layer],a.texture);entities.push({id:e.id,vertices:mesh.geometry.getAttribute('position').count});mesh.geometry.dispose()}catch(error){entities.push({id:e.id,error:error.message})}}}
 const failed=[...failures.values()]
 const result={blocks:profile.blocks.length,entityTypes:profile.entities.length,creativeTabs:profile.creativeTabs.length,modelLayers:Object.keys(profile.entityModels).length,statesVisited:states,uniqueModelApplications:models,emptyModels:empty,unsupportedBlockTypes:failed.length,unsupportedStates:failed.reduce((n,f)=>n+f.count,0),unsupportedOrdinaryBlocks:failed.filter(f=>!profile.blocks.find(b=>b.id===f.id)?.hasBlockEntity).map(f=>f.id),failures:failed,entityBindings:entities,milliseconds:Math.round(performance.now()-start)}
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/renderer-audit.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify({...result,failures:undefined,entityBindings:entities.map(e=>e.error?e:e.id)},null,2))
}finally{await server.close()}
