import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
import {setTimeout as delay} from 'node:timers/promises'

// Independent minimal Java NBT fixture builder, not the application's writer.
function encode(root){
  const output=[]
  const num=(value,n)=>{for(let i=n-1;i>=0;i--)output.push(value>>>(i*8)&255)}
  const text=value=>{const bytes=Buffer.from(value,'utf8');num(bytes.length,2);output.push(...bytes)}
  const payload=tag=>{if(tag.type===3)num(tag.value,4);else if(tag.type===8)text(tag.value);else if(tag.type===9){output.push(tag.element);num(tag.value.length,4);tag.value.forEach(payload)}else if(tag.type===10){for(const [name,child]of Object.entries(tag.value)){output.push(child.type);text(name);payload(child)}output.push(0)}else throw new Error('Bad fixture tag')}
  output.push(10);text('');payload(root);return Buffer.from(output)
}
const i=value=>({type:3,value}),s=value=>({type:8,value}),l=(element,value)=>({type:9,element,value}),c=value=>({type:10,value})
export async function runNbtImportScenarios({command,evaluate,until,click,aria,upload,key,screenshot,directory}){
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  const snapshot=()=>evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`)
  const current=await snapshot()
  const states=[{name:'minecraft:oak_log',properties:{axis:'x'}},{name:'minecraft:red_bed',properties:{facing:'east',part:'foot',occupied:'false'}},{name:'minecraft:red_bed',properties:{facing:'east',part:'head',occupied:'false'}},{name:'minecraft:air',properties:{}}]
  const positions=[[0,1,0],[0,0,0],[1,0,0],[3,0,0]]
  const root=c({DataVersion:i(4903),size:l(3,[i(4),i(2),i(2)]),palette:l(10,states.map(state=>c({Name:s(state.name),...(Object.keys(state.properties).length?{Properties:c(Object.fromEntries(Object.entries(state.properties).map(([k,v])=>[k,s(v)])))}:{} )}))),blocks:l(10,positions.map((pos,index)=>c({state:i(index),pos:l(3,pos.map(i))}))),entities:l(10,[])})
  const rawPath=join(directory,'External room.nbt'),gzipPath=join(directory,'External room gzip.nbt'),payloadPath=join(directory,'Payload.nbt'),versionPath=join(directory,'Old version.nbt')
  const raw=encode(root);await writeFile(rawPath,raw);await writeFile(gzipPath,gzipSync(raw))
  const payload=structuredClone(root);payload.value.blocks.value[0].value.nbt=c({id:s('minecraft:chest')});await writeFile(payloadPath,gzipSync(encode(payload)))
  const old=structuredClone(root);old.value.DataVersion=i(1);await writeFile(versionPath,encode(old))
  const open=async()=>{await click(aria('Open Structure NBT import'));await until(`document.querySelector('dialog[open] h2')?.textContent==='Import Structure NBT'`)}
  const inspect=async path=>{await upload(aria('Import Structure NBT file'),path);await until(`Boolean(document.querySelector('[aria-label="Structure import report"]'))`)}
  await open();await inspect(rawPath)
  assert.ok(await evaluate(`document.querySelector('[aria-label="Structure import report"]').textContent.includes('1 multi-blocks')`))
  assert.equal(await snapshot(),current,'Inspection must not mutate current document')
  await click(aria('Close Import Structure NBT'));assert.equal(await snapshot(),current)
  await open();await upload(aria('Import Structure NBT file'),payloadPath)
  await until(`document.querySelector('dialog [role="alert"]')?.textContent.includes('payload')`)
  assert.ok(await evaluate(`document.querySelector('[aria-label="Confirm Structure NBT import"]').disabled`))
  await upload(aria('Import Structure NBT file'),versionPath);await until(`document.querySelector('dialog [role="alert"]')?.textContent.includes('4903')`)
  assert.equal(await snapshot(),current)
  await inspect(gzipPath)
  await click(aria('Accept Structure NBT import policy'))
  await screenshot('nbt-import-report')
  await evaluate(`(()=>{const put=IDBObjectStore.prototype.put;window.__restoreNbtPut=()=>{IDBObjectStore.prototype.put=put};IDBObjectStore.prototype.put=function(...args){if(this.name==='preferences')throw new DOMException('Injected NBT quota failure','QuotaExceededError');return put.apply(this,args)}})()`)
  try{await click(aria('Confirm Structure NBT import'));await until(`document.querySelector('dialog [role="alert"]')?.textContent.includes('Injected NBT quota failure')`);assert.equal(await snapshot(),current,'Failed import must keep original scene')}
  finally{await evaluate('window.__restoreNbtPut();delete window.__restoreNbtPut')}
  await click(aria('Confirm Structure NBT import'));await until(`!document.querySelector('dialog[open]') && document.querySelector('.document-saved')`)
  const imported=JSON.parse(await snapshot())
  assert.equal(imported.cells.length,4)
  assert.equal(imported.objects.filter(object=>object.kind==='multiblock').length,1)
  for(let index=0;index<positions.length;index++)assert.ok(imported.cells.some(cell=>JSON.stringify(cell.pos)===JSON.stringify(positions[index])&&cell.state.name===states[index].name&&JSON.stringify(cell.state.properties)===JSON.stringify(states[index].properties)))
  await evaluate(`document.querySelector('canvas').focus()`);await key('KeyZ','z',2)
  assert.equal(await snapshot(),JSON.stringify(imported),'Import is a document switch, not an edit Undo command')
  const id=imported.id,previous=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${previous} && document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  assert.equal(JSON.parse(await snapshot()).id,id)
  const downloads=join(directory,'nbt-import-downloads');await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await click(aria('Export editor document'))
  let saved
  for(let n=0;n<100;n++){try{saved=JSON.parse(await readFile(join(downloads,'External room gzip.blockstage.json'),'utf8'));break}catch{await delay(100)}}
  assert.equal(saved.objects.flatMap(object=>object.cells).length,4)
  assert.equal(saved.objects.filter(object=>object.kind==='multiblock').length,1)
  await click(aria('Export Minecraft'));await until(`Boolean(document.querySelector('[aria-label="Download Minecraft export"]'))`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Download Minecraft export"]').disabled`),false,'Supported imported cells must pass NBT export preflight')
  await click(aria('Download Minecraft export'));await click(aria('Close Export Minecraft'))
  await open();await inspect(rawPath)
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:800,deviceScaleFactor:1,mobile:false})
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('dialog').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight})()`))
  await screenshot('nbt-import-compact');await click(aria('Close Import Structure NBT'))
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  console.log(JSON.stringify({nbtImportResult:'passed',checks:['independent raw/gzip external fixture','palette/blockstate/bed reconstruction/explicit air','inspect and cancel no mutation','payload/version reject','injected transaction failure retains current scene','atomic Saved import/reload/JSON','export preflight/download','620px import dialog']}))
}
