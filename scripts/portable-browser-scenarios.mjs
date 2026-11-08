import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function runPortableScenarios({command,evaluate,until,click,aria,upload,screenshot,directory,createPeer}) {
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'))
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  await until(ready)
  const stone={id:'portable-log',name:'Beam',kind:'block',cells:[{pos:[-4,3,2],state:{name:'minecraft:oak_log',properties:{axis:'x'}}}],children:[],pivot2:[-7,7,5],orientation:0}
  const bed={id:'portable-bed',name:'Bed',kind:'multiblock',cells:[{pos:[0,0,0],state:{name:'minecraft:red_bed',properties:{facing:'north',part:'foot',occupied:'false'}}},{pos:[0,0,-1],state:{name:'minecraft:red_bed',properties:{facing:'north',part:'head',occupied:'false'}}}],children:[],pivot2:[1,1,1],orientation:0}
  const fixture={schemaVersion:2,id:'portable-source',name:'Portable room',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},entities:[{id:'portable-pig',type:'minecraft:pig',position:[1.25,0,-1.5],yaw:90}],objects:[{id:'portable-group',name:'Room',kind:'group',cells:[],children:[stone,bed],pivot2:[1,1,1],orientation:0}]}
  const sourcePath=join(directory,'portable-source.json')
  await writeFile(sourcePath,JSON.stringify(fixture));await upload(aria('Import editor document'),sourcePath)
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='3'`)
  await until(`document.querySelector('[aria-label="Draft protection"]')?.dataset.phase==='protected'`)
  const sourceId=await evaluate(`document.querySelector('.editor-diagnostics').dataset.document`)
  const downloads=join(directory,'portable-downloads');await mkdir(downloads,{recursive:true})
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await click(aria('Manage editor documents'));await until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`)
  await click(aria('Portable backup tab'));await click(aria('Download portable backup'))
  await until(`document.querySelector('.portable-backup [role="status"]')?.textContent.includes('Backup created')`)
  const backupPath=join(downloads,'Portable room.blockstage-backup.json')
  let backup
  for(let i=0;i<100;i++){try{backup=JSON.parse(await readFile(backupPath,'utf8'));break}catch{await delay(100)}}
  assert.equal(backup?.format,'blockstage-portable')
  assert.ok(backup.components.length>0,'Existing library must be included in backup')
  assert.ok(backup.resources.profile?.sha256)
  assert.ok(backup.resources.packs.length>0)
  assert.equal(JSON.stringify(backup).includes('assets/minecraft/textures/'),false,'Backup must contain no pack files')
  const sourceOrigin=new URL(process.env.BLOCKSTAGE_URL??'http://127.0.0.1:5173/'),freshUrl=new URL(sourceOrigin)
  freshUrl.hostname=sourceOrigin.hostname==='127.0.0.1'?'localhost':'127.0.0.1'
  const peer=await createPeer(freshUrl.href)
  const pc=selector=>peer.evaluate(`(()=>{const item=document.querySelector(${JSON.stringify(selector)});if(!item||item.disabled)throw new Error('Missing control '+${JSON.stringify(selector)});item.click()})()`)
  const pa=label=>`[aria-label=${JSON.stringify(label)}]`
  const pu=async(selector,path)=>{const root=await peer.command('DOM.getDocument'),node=await peer.command('DOM.querySelector',{nodeId:root.root.nodeId,selector});assert.ok(node.nodeId);await peer.command('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[path]})}
  const stores=()=>peer.evaluate(`new Promise((resolve,reject)=>{const req=indexedDB.open('blockstage-studio');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,names=Array.from(db.objectStoreNames),tx=db.transaction(names),result={};for(const name of names){const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result}}tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>reject(tx.error)}})`)
  const open=async()=>{await pc(pa('Manage editor documents'));await peer.until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`);await pc(pa('Portable backup tab'))}
  const report=()=>peer.until(`Boolean(document.querySelector('[aria-label="Backup import report"]')) && !document.querySelector('[aria-label="Accept missing backup resources"]')?.disabled && !Array.from(document.querySelectorAll('.portable-backup [role="status"]')).some(item=>item.textContent.includes('Checking current resources'))`)
  try{
    await peer.evaluate(`document.querySelector('[aria-label="Architecture workspace"]').click()`);await peer.until(ready)
    const before=await stores();assert.equal(before.packs.length,0);assert.equal(before.editorDocuments.length,0);assert.equal(before.componentAssets.length,0)
    await open();await pu(pa('Import portable backup'),backupPath);await report()
    assert.ok(await peer.evaluate(`document.querySelector('.backup-report').textContent.includes('Missing or disabled pack')`))
    assert.ok(await peer.evaluate(`document.querySelector('[aria-label="Restore portable backup"]').disabled`),'Missing resources require explicit acknowledgement')
    await pc(pa('Cancel backup import'))
    assert.deepEqual(await stores(),before,'Cancel import must not change any store')
    const invalidPath=join(directory,'portable-unsupported.json');await writeFile(invalidPath,JSON.stringify({...backup,nbt:{unsupported:true}}))
    await pu(pa('Import portable backup'),invalidPath);await peer.until(`Boolean(document.querySelector('.portable-backup [role="alert"]'))`)
    assert.deepEqual(await stores(),before,'Unsupported payload must not change storage')
    await pu(pa('Import portable backup'),backupPath);await report();await pc(pa('Accept missing backup resources'))
    await peer.evaluate(`(()=>{const put=IDBObjectStore.prototype.put;window.__restorePortablePut=()=>{IDBObjectStore.prototype.put=put};IDBObjectStore.prototype.put=function(...args){if(this.name==='preferences')throw new DOMException('Injected backup quota failure','QuotaExceededError');return put.apply(this,args)}})()`)
    try{await pc(pa('Restore portable backup'));await peer.until(`document.querySelector('.portable-backup [role="alert"]')?.textContent.includes('Injected backup quota failure')`);assert.deepEqual(await stores(),before,'Restore failure must roll back document/components/revision/preference')}
    finally{await peer.evaluate('window.__restorePortablePut();delete window.__restorePortablePut')}
    await peer.command('Emulation.setDeviceMetricsOverride',{width:620,height:800,deviceScaleFactor:1,mobile:false})
    assert.ok(await peer.evaluate(`(()=>{const r=document.querySelector('.documents-dialog').getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight})()`))
    const image=await peer.command('Page.captureScreenshot',{format:'png'});await writeFile('artifacts/portable-import-compact.png',Buffer.from(image.data,'base64'))
    await pc(pa('Restore portable backup'));await peer.until(`!document.querySelector('.documents-dialog') && Boolean(document.querySelector('.document-saved'))`)
    const after=await stores(),restored=after.editorDocuments[0]
    assert.notEqual(restored.id,sourceId)
    assert.equal(restored.name,fixture.name);assert.equal(restored.objects[0].kind,'group')
    assert.deepEqual(restored.objects[0].children.map(o=>o.cells),fixture.objects[0].children.map(o=>o.cells))
    assert.deepEqual(restored.objects[0].pivot2,fixture.objects[0].pivot2)
    assert.deepEqual(restored.entities.map(({id:_id,...rest})=>rest),fixture.entities.map(({id:_id,...rest})=>rest))
    assert.equal(after.componentAssets.length,backup.components.length)
    assert.ok(after.componentAssets.every(asset=>!backup.components.some(source=>source.id===asset.id)))
    assert.equal(after.packs.length,0,'Restore must not copy or automatically fetch packs')
    const old=await peer.evaluate('performance.timeOrigin');await peer.command('Page.reload');await peer.until(`performance.timeOrigin!==${old} && (${ready})`)
    assert.equal(await peer.evaluate(`document.querySelector('.editor-diagnostics').dataset.document`),restored.id)
    await peer.command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
    await pc(pa('Export editor document'))
    let exported
    for(let i=0;i<100;i++){try{exported=JSON.parse(await readFile(join(downloads,'Portable room.blockstage.json'),'utf8'));break}catch{await delay(100)}}
    assert.deepEqual(exported,restored,'Fresh-origin JSON export must preserve restored document exactly')
    // A repeated import creates a separate copy; it does not replace the first restore.
    await open();await pu(pa('Import portable backup'),backupPath);await report();await pc(pa('Accept missing backup resources'));await pc(pa('Restore portable backup'))
    await peer.until(`!document.querySelector('.documents-dialog')`)
    const twice=await stores();assert.equal(twice.editorDocuments.length,2);assert.deepEqual(twice.editorDocuments.find(doc=>doc.id===restored.id),restored)
    assert.equal(twice.componentAssets.length,backup.components.length*2)

    // Recover the original resource stack through the backup report, without restoring again.
    const documentStatus=()=>peer.evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {document:d.document,revision:d.revision,history:d.history,snapshot:d.snapshot}})()`)
    const recoveryBefore=await stores(),documentBefore=await documentStatus()
    await open();await pu(pa('Import portable backup'),backupPath);await report()
    assert.equal(await peer.evaluate(`!!document.querySelector('[aria-label="Relink backup game profile"]')`),true)
    await pc(pa('Accept missing backup resources'))
    const badPack=join(directory,'portable-bad-pack.zip');await writeFile(badPack,'not a ZIP archive')
    await pu(pa('Relink backup resource pack'),badPack)
    await peer.until(`Boolean(document.querySelector('[aria-label="Backup resource compatibility"] [role="alert"]'))`)
    assert.deepEqual(await stores(),recoveryBefore,'Invalid resource import must preserve all stores and the pending backup')
    assert.equal(await peer.evaluate(`!!document.querySelector('[aria-label="Backup import report"]')`),true)
    const originalPack=process.env.BLOCKSTAGE_RESOURCE_PACK??join(directory,'base-fixture.zip')
    await pu(pa('Relink backup resource pack'),originalPack)
    await peer.until(`document.querySelector('[aria-label="Relink backup resource pack"]').disabled===false`);await report()
    const recoveredResources=await stores(),relinked=recoveredResources.packs[0]
    assert.ok(relinked?.fingerprint,'User-selected pack must persist before the report acknowledges it')
    const requiredPack=backup.resources.packs.find(pack=>pack.enabled&&pack.fingerprint===relinked.fingerprint)
    assert.ok(requiredPack,'The selected original file must match a recorded fingerprint')
    const requiredRow=`[aria-label="Required backup packs"] li[title=${JSON.stringify(requiredPack.fingerprint)}]`
    await peer.until(`document.querySelector(${JSON.stringify(requiredRow)})?.textContent.includes('matched')`)
    assert.equal(await peer.evaluate(`document.querySelector('[aria-label="Accept missing backup resources"]')?.checked??false`),false,'Resource changes retire the old acknowledgement')
    await peer.evaluate(`document.querySelector('[aria-label="Backup resource compatibility"] details').open=true`)
    await pc(pa(`Toggle backup resource ${relinked.name}`));await report()
    await peer.until(`document.querySelector(${JSON.stringify(requiredRow)})?.textContent.includes('disabled')`)
    await pc(pa('Accept missing backup resources'))
    await pc(pa(`Enable backup pack ${requiredPack.name}`));await report()
    await peer.until(`document.querySelector(${JSON.stringify(requiredRow)})?.textContent.includes('matched')`)
    assert.equal(await peer.evaluate(`document.querySelector('[aria-label="Accept missing backup resources"]')?.checked??false`),false)
    assert.equal(await peer.evaluate(`document.querySelector('[aria-label="Restore portable backup"]').disabled`),true)
    const afterResources=await stores()
    for(const name of Object.keys(recoveryBefore).filter(name=>name!=='packs'))assert.deepEqual(afterResources[name],recoveryBefore[name],`Resource recovery must not change ${name}`)
    assert.deepEqual(await documentStatus(),documentBefore,'Resource repair must not change committed document/history')
    await peer.command('Emulation.setDeviceMetricsOverride',{width:620,height:800,deviceScaleFactor:1,mobile:false})
    await peer.evaluate(`document.querySelector('[aria-label="Relink backup resource pack"]').parentElement.scrollIntoView({block:'center'})`)
    const repairImage=await peer.command('Page.captureScreenshot',{format:'png'});await writeFile('artifacts/portable-resources-compact.png',Buffer.from(repairImage.data,'base64'))
    assert.equal(await peer.evaluate(`(()=>{const r=document.querySelector('[aria-label="Relink backup resource pack"]').parentElement.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`),true)
    await pc(pa('Cancel backup import'))
    const wrongFingerprint=structuredClone(backup)
    wrongFingerprint.resources.packs.find(pack=>pack.fingerprint===requiredPack.fingerprint).fingerprint='0'.repeat(64)
    const wrongPath=join(directory,'portable-wrong-fingerprint.json');await writeFile(wrongPath,JSON.stringify(wrongFingerprint))
    await pu(pa('Import portable backup'),wrongPath);await report()
    assert.ok(await peer.evaluate(`document.querySelector('[aria-label="Required backup packs"] li[title="${'0'.repeat(64)}"]')?.textContent.includes('missing')`),'Same name with a different fingerprint must remain missing')
    await pc(pa('Cancel backup import'))
    assert.equal((await stores()).editorDocuments.length,2,'Repair and cancel never restore an extra document')
  }finally{await peer.close()}
  assert.equal(await evaluate(`document.querySelector('.editor-diagnostics').dataset.document`),sourceId,'Fresh-origin import must not change source session')
  await screenshot('portable-source-backup');await click(aria('Close Documents'))
  console.log(JSON.stringify({portableResult:'passed',checks:['downloaded document/library/manifest file','fresh origin without packs/profile/DB','missing resource acknowledgement','cancel/invalid import no mutation','atomic injected quota rollback','independent restored IDs/data','reload and JSON export roundtrip','repeat import preserves existing records','inline resource reimport and exact disabled-pack enable','resource changes retire acknowledgements','wrong fingerprint and failed resource import preserve data','620px report and resource controls']}))
}
