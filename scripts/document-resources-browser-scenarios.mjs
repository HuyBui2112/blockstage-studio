import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

/** Explicit document metadata, independent JSON downloads and real resource controls. */
export async function runDocumentResourcesScenarios({command,evaluate,until,click,aria,upload,screenshot,directory}) {
  const name='Document resources fixture', downloads=join(directory,'document-resource-downloads')
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const panel='[aria-label="Document resources"]'
  const record=aria('Record current document resources')
  const object={id:'resource-beam',name:'Beam',kind:'block',cells:[{pos:[-3,2,4],state:{name:'minecraft:oak_log',properties:{axis:'x'}}}],children:[],pivot2:[-5,5,9],orientation:0}
  const fixture={schemaVersion:2,id:'document-resource-input',name,workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[object],entities:[]}
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history,snapshot:d.snapshot}})()`)
  const stable=()=>until(`document.querySelector(${JSON.stringify(panel)})?.getAttribute('aria-busy')==='false' && document.querySelector(${JSON.stringify(record)})?.disabled===false`)
  async function open(){await click(aria('Manage editor documents'));await until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`);await click(aria('Document resources tab'));await stable()}
  async function close(){await click(aria('Close Documents'));await until(`!document.querySelector('.documents-dialog')`)}
  async function save(){await click('.document-actions > button.primary');await until(`!!document.querySelector('.document-saved')`)}
  async function exported(){
    await unlink(join(downloads,`${name}.blockstage.json`)).catch(error=>{if(error.code!=='ENOENT')throw error})
    await click(aria('Export editor document'))
    for(let n=0;n<100;n++){try{return JSON.parse(await readFile(join(downloads,`${name}.blockstage.json`),'utf8'))}catch{await delay(100)}}
    throw new Error('Document resource JSON download missing')
  }
  const storedPacks=()=>evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('blockstage-studio');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('packs'),q=tx.objectStore('packs').getAll();q.onsuccess=()=>{db.close();resolve(q.result.map(({name,fingerprint,enabled,priority,source})=>({name,fingerprint,enabled,priority,source})).sort((a,b)=>b.priority-a.priority))};q.onerror=()=>reject(q.error)}})`)
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  const file=join(directory,'document-resource-fixture.json');await writeFile(file,JSON.stringify(fixture));await upload(aria('Import editor document'),file)
  await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(name)}`);await save()
  const before=await exported(),beforeStatus=await status(),packs=await storedPacks()
  assert.equal(Object.hasOwn(before,'resources'),false,'Legacy v2 remains without an invented manifest')
  assert.ok(packs.some(pack=>pack.enabled&&pack.fingerprint),'Harness must supply a fingerprinted enabled pack')
  await open();assert.ok(await evaluate(`document.querySelector(${JSON.stringify(panel)}).textContent.includes('No resource manifest recorded')`))
  assert.deepEqual(await status(),beforeStatus,'Opening resource comparison must not edit the document')
  await close();assert.deepEqual(await exported(),before)
  await open();await click(record);await close()
  const recorded=await exported()
  assert.deepEqual(recorded.objects,before.objects);assert.deepEqual(recorded.entities,before.entities)
  assert.equal(recorded.resources.adapter,'blockstage-editor-v2-copy')
  assert.deepEqual(recorded.resources.packs,packs.map(({name,fingerprint,enabled,source})=>({name,fingerprint:fingerprint??null,enabled,source:source??'unknown'})))
  assert.equal(Number((await status()).history),Number(beforeStatus.history)+1)
  await click(aria('Undo editor'));assert.deepEqual(await exported(),before)
  await click(aria('Redo editor'));assert.deepEqual(await exported(),recorded)
  await save()
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`)
  assert.deepEqual(await exported(),recorded,'Saved document keeps its resource manifest after reload')

  const target=recorded.resources.packs.find(pack=>pack.enabled&&pack.fingerprint)
  const row=`[aria-label="Required backup packs"] li[title=${JSON.stringify(target.fingerprint)}]`
  const savedStatus=await status()
  await open();await until(`document.querySelector(${JSON.stringify(row)})?.textContent.includes('matched')`)
  await evaluate(`document.querySelector('[aria-label="Backup resource compatibility"] details').open=true`)
  await click(aria(`Toggle backup resource ${target.name}`));await stable()
  await until(`document.querySelector(${JSON.stringify(row)})?.textContent.includes('disabled')`)
  assert.deepEqual(await status(),savedStatus,'Pack changes refresh the report without editing document metadata/history')
  await close();assert.deepEqual(await exported(),recorded,'Pack changes never overwrite the recorded stack automatically')
  await open();await click(record);await close()
  const replaced=await exported()
  assert.equal(replaced.resources.packs.find(pack=>pack.fingerprint===target.fingerprint).enabled,false)
  assert.deepEqual(replaced.objects,recorded.objects)
  await click(aria('Undo editor'));assert.deepEqual(await exported(),recorded,'One Undo restores the previous required stack')
  await open();await until(`document.querySelector(${JSON.stringify(row)})?.textContent.includes('disabled')`)
  await click(aria(`Enable backup pack ${target.name}`));await stable()
  await until(`document.querySelector(${JSON.stringify(row)})?.textContent.includes('matched')`)
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:800,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector(${JSON.stringify(record)}).scrollIntoView({block:'center'})`)
  await screenshot('document-resources-compact')
  assert.equal(await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(record)}),r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===b})()`),true)
  await close();await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await save()
  const previousId=await evaluate(`document.querySelector('.editor-diagnostics').dataset.document`)
  const jsonPath=join(directory,'document-resource-roundtrip.json');await writeFile(jsonPath,JSON.stringify(recorded));await upload(aria('Import editor document'),jsonPath)
  await until(`document.querySelector('.editor-diagnostics').dataset.document!==${JSON.stringify(previousId)}&&(${ready})`)
  const roundtrip=await exported();assert.deepEqual(roundtrip.resources,recorded.resources);assert.deepEqual(roundtrip.objects,recorded.objects)
  await save()
  console.log(JSON.stringify({documentResourcesResult:'passed',checks:['legacy v2 opens without automatic manifest','explicit current-resource capture and exact fingerprint order','one Undo/Redo for metadata only','Save/reload and JSON roundtrip','disabled-pack comparison and explicit repair','pack changes do not overwrite the recorded manifest','explicit replacement Undo','620px action visible and unclipped'],limits:['resource expectations are recorded explicitly; no embedded assets','scripted editor workflow; no game world proof']}))
}
