import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

/** Explicit read-only previews; stored source JSON and editor state are checked independently. */
export async function runComponentPreviewScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory}) {
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const dialog='.component-preview-dialog',canvas=`${dialog} canvas`
  const name='Read-only architectural preview'
  const leaf=(id,pos,block,properties={})=>({id,name:id,kind:'block',cells:[{pos,state:{name:`minecraft:${block}`,properties}}],children:[],pivot2:pos.map(v=>2*v+1),orientation:0})
  const asset={schemaVersion:1,id:'preview-source',name,objects:[
    leaf('beam',[12,3,-5],'oak_log',{axis:'x'}),
    leaf('glass',[13,3,-5],'glass'),
    leaf('stair',[14,3,-5],'oak_stairs',{facing:'east',half:'bottom',shape:'straight',waterlogged:'false'}),
  ],pivot2:[25,7,-9],size:[3,1,1],orientation:0}
  const editor=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {snapshot:d.snapshot,revision:d.revision,history:d.history,saved:!!document.querySelector('.document-saved'),selected:document.querySelector('.component-asset.chosen')?.dataset.componentId??null}})()`)
  const downloads=join(directory,'component-preview-downloads')
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  async function exportAsset(){
    const path=join(downloads,`${name}.component.json`)
    await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error})
    await click(aria(`Export component ${name}`))
    for(let n=0;n<100;n++){try{return JSON.parse(await readFile(path,'utf8'))}catch{await delay(100)}}
    throw new Error('Component preview source export missing')
  }
  async function preview(assetName=name){
    await evaluate(`document.querySelector(${JSON.stringify(aria(`Preview component ${assetName}`))}).focus()`)
    await click(aria(`Preview component ${assetName}`))
    await until(`document.querySelector('${dialog}')?.open===true`)
  }
  async function close(){await click(aria('Close Component preview'));await until(`!document.querySelector('${dialog}')`)}
  async function rendered(){await until(`(()=>{const c=document.querySelector('${canvas}');return c&&c.width>100&&c.height>100&&c.dataset.projection==='perspective'})()`);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')}
  async function resourceManager(){
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.trim().startsWith('Resources')).click()`)
    await until(`!!document.querySelector('[aria-label="Import resource pack"]')`)
  }
  async function toggle(label,checked){await click(aria(label));await until(`(()=>{const c=document.querySelector(${JSON.stringify(aria(label))});return c&&!c.disabled&&c.checked===${checked}})()`)}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await click('.editor-library-tabs button:nth-child(2)')
  const path=join(directory,'preview-source.component.json');await writeFile(path,JSON.stringify(asset));await upload(aria('Import component JSON'),path)
  await input(aria('Search components'),name);await until(`!!document.querySelector('[aria-label="Preview component ${name}"]')`)
  const source=await exportAsset(),before=await editor()
  assert.deepEqual({...source,id:asset.id},asset)
  await until(`(()=>{const image=document.querySelector('.component-thumbnail img');return image?.complete&&image.naturalWidth===192&&image.naturalHeight===144})()`)
  assert.equal(await evaluate(`document.querySelector('.component-thumbnail').dataset.thumbnailSource`),'render')
  const thumbnailRecords=()=>evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('blockstage-component-thumbnails',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('thumbnails');const read=tx.objectStore('thumbnails').getAll();read.onsuccess=()=>resolve(read.result.map(record=>({key:record.key,size:record.blob.size,type:record.blob.type})));tx.oncomplete=()=>db.close()}})`)
  assert.ok((await thumbnailRecords()).some(record=>record.type==='image/png'&&record.size>100),'Real rendered PNG is persisted separately from component JSON')
  await screenshot('component-thumbnail-card')
  await preview();await rendered()
  assert.equal(await evaluate(`document.querySelectorAll('${canvas}').length`),1)
  await screenshot('component-preview-textured')
  await click(aria('Frame component preview'))
  const point=await evaluate(`(()=>{const r=document.querySelector('${canvas}').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.5}})()`)
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
  await command('Input.dispatchMouseEvent',{type:'mousePressed',button:'middle',buttons:4,clickCount:1,...point})
  await command('Input.dispatchMouseEvent',{type:'mouseMoved',button:'middle',buttons:4,x:point.x+45,y:point.y+20})
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'middle',buttons:0,clickCount:1,x:point.x+45,y:point.y+20})
  await evaluate(`document.querySelector('${canvas}').focus()`)
  await key('KeyG','g');await key('Delete','Delete');await key('KeyS','s',2)
  assert.deepEqual(await editor(),before,'Preview navigation/edit/save shortcuts must not edit or save the working document')
  await key('Escape','Escape');await until(`!document.querySelector('${dialog}')`)
  assert.equal(await evaluate(`document.querySelectorAll('.component-preview-canvas canvas').length`),0)
  assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`),`Preview component ${name}`)
  assert.deepEqual(await exportAsset(),source,'Preview must not mutate its library source')
  for(let n=0;n<2;n++){await preview();await rendered();assert.equal(await evaluate(`document.querySelectorAll('${canvas}').length`),1);await close()}

  // Removing enabled resources produces visible, actionable notes; restore the exact prior switches.
  await resourceManager()
  const enabled=await evaluate(`Array.from(document.querySelectorAll('.pack-toggle input')).filter(input=>input.checked).map(input=>input.getAttribute('aria-label'))`)
  assert.ok(enabled.length,'Harness requires enabled resources for real textured preview')
  for(const label of enabled)await toggle(label,false)
  await click(aria('Close Resources'))
  await until(`!document.querySelector('.component-thumbnail img')`)
  await preview();await rendered()
  await until(`document.querySelector('${dialog} .component-preview-issues')?.textContent.length>0`)
  assert.ok(await evaluate(`document.querySelector('${dialog}').textContent.toLowerCase().includes('unavailable')||document.querySelector('${dialog}').textContent.toLowerCase().includes('missing')`))
  await screenshot('component-preview-missing-resources')
  await click(aria('Open component preview resources'))
  await until(`!document.querySelector('${dialog}')&&!!document.querySelector('[aria-label="Import resource pack"]')`)
  for(const label of enabled)await toggle(label,true)
  await click(aria('Close Resources'))
  await until(`document.querySelector('.component-thumbnail').dataset.thumbnailSource==='cache'`)
  await preview();await rendered()
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  await screenshot('component-preview-compact')
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('${dialog}').getBoundingClientRect(),b=document.querySelector('[aria-label="Close Component preview"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&b.top>=0&&b.bottom<=innerHeight})()`),true)
  await close();assert.deepEqual(await editor(),before)
  assert.deepEqual(await exportAsset(),source)
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})

  // Large samples are explicitly limited rather than rendering a cropped/fake preview.
  const largeName='Large preview limit fixture'
  const large={schemaVersion:1,id:'preview-large',name:largeName,objects:[{id:'large-root',name:'Stored cells',kind:'component',cells:Array.from({length:10001},(_,x)=>({pos:[x,0,0],state:{name:'minecraft:stone',properties:{}}})),children:[],pivot2:[1,1,1],orientation:0}],pivot2:[1,1,1],size:[10001,1,1],orientation:0}
  const largePath=join(directory,'preview-large.component.json');await writeFile(largePath,JSON.stringify(large));await upload(aria('Import component JSON'),largePath)
  await input(aria('Search components'),largeName);await until(`!!document.querySelector('[aria-label="Preview component ${largeName}"]')`)
  await preview(largeName)
  await until(`document.querySelector('${dialog}').textContent.includes('exceeds the preview limit')`)
  assert.equal(await evaluate(`document.querySelectorAll('${canvas}').length`),0)
  await close();assert.deepEqual(await editor(),before)
  await until(`document.querySelector('.component-thumbnail')?.dataset.thumbnailStatus==='unavailable'`)
  assert.equal(await evaluate(`document.querySelectorAll('.component-thumbnail-renderer canvas').length`),0)
  await input(aria('Search components'),name)
  assert.deepEqual(await exportAsset(),source)
  await command('Page.reload')
  await until(`!!document.querySelector('[aria-label="Architecture workspace"]')`)
  await click(aria('Architecture workspace'));await until(ready)
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await click('.editor-library-tabs button:nth-child(2)')
  await input(aria('Search components'),name)
  await until(`(()=>{const card=document.querySelector('.component-thumbnail'),image=card?.querySelector('img');return card?.dataset.thumbnailSource==='cache'&&image?.complete&&image.naturalWidth===192})()`)
  assert.deepEqual(await exportAsset(),source,'Reloaded thumbnail cache does not change component JSON')
  await screenshot('component-thumbnail-reloaded')
  console.log(JSON.stringify({componentPreviewResult:'passed',checks:['actual textured read-only preview','persisted 192x144 PNG card thumbnail','cache reused after resource restore and browser reload','resource removal clears stale thumbnail','Frame and native MMB navigation','G/Delete/Ctrl+S do not edit or save','unchanged complete library JSON and editor history','Escape restores focus and closes owned canvas','repeated preview creates one canvas only','missing resource notes and direct Resources recovery','enabled packs restored exactly','10001-cell limit without cropped render or thumbnail','620px dialog'],limits:['local bounded derived-image cache, not embedded in exported components','scripted browser rendering; no game/world parity']}))
}
