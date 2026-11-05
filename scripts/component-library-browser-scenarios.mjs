import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function runComponentLibraryScenarios({command,evaluate,until,click,aria,input,upload,screenshot,directory}){
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await click('.editor-library-tabs button:nth-child(2)')
  const original=await evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {history:d.history,revision:d.revision}})()`)
  const before=await status(),initial=await evaluate(`Number(document.querySelector('.editor-library-tabs button:nth-child(2) span').textContent)`)
  const fixtures=[]
  for(let i=0;i<25;i++){
    const count=i+1,name=`Cột thư viện ${String(i).padStart(2,'0')}`
    const objects=Array.from({length:count},(_,x)=>({id:`cell-${x}`,name:'Log',kind:'block',cells:[{pos:[x,0,0],state:{name:'minecraft:oak_log',properties:{axis:'y'}}}],children:[],pivot2:[2*x+1,1,1],orientation:0}))
    const asset={schemaVersion:1,id:`library-${i}`,name,objects,pivot2:[1,1,1],size:[count,1,1],orientation:0}
    const path=join(directory,`library-${i}.component.json`);await writeFile(path,JSON.stringify(asset));await upload(aria('Import component JSON'),path)
    await until(`Number(document.querySelector('.editor-library-tabs button:nth-child(2) span').textContent)===${initial+i+1}`)
    fixtures.push(asset)
  }
  assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),24)
  await input(aria('Search components'),'cot thu vien minecraft:oak_log')
  await until(`document.querySelector('[aria-label="Component results"]').textContent.includes('25')`)
  assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),24)
  await click(aria('Show more components'));assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),25)
  await input(aria('Sort components'),'cells-desc')
  assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),24)
  assert.equal(await evaluate(`document.querySelector('.component-asset-main strong').textContent`),fixtures[24].name)
  await input(aria('Sort components'),'cells-asc');assert.equal(await evaluate(`document.querySelector('.component-asset-main strong').textContent`),fixtures[0].name)
  await input(aria('Search components'),'cot thu vien 24 oak_log')
  assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),1)
  const chosenId=await evaluate(`document.querySelector('.component-asset').dataset.componentId`)
  await click('.component-asset-main')
  assert.equal(await evaluate(`document.querySelector('.component-asset.chosen').dataset.componentId`),chosenId)
  await input(aria('Search components'),'nothing matches this fixture')
  assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),0)
  assert.ok(await evaluate(`document.querySelector('.editor-library').textContent.includes('No matching components')`))
  await click(aria('Clear component search'))
  assert.equal(await evaluate(`document.querySelector('[aria-label="Search components"]').value`),'')
  assert.equal(await evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`),original)
  assert.deepEqual(await status(),before)
  await input(aria('Search components'),'cot thu vien 24')
  const downloads=join(directory,'library-downloads');await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await click(aria(`Export component ${fixtures[24].name}`))
  let exported;for(let i=0;i<100;i++){try{exported=JSON.parse(await readFile(join(downloads,`${fixtures[24].name}.component.json`),'utf8'));break}catch{await delay(100)}}
  assert.deepEqual(exported,{...fixtures[24],id:chosenId})
  await screenshot('component-library-search-desktop')
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await click('.editor-library-tabs button:nth-child(2)');await input(aria('Search components'),'cot thu vien 24')
  assert.equal(await evaluate(`document.querySelector('.component-asset').dataset.componentId`),chosenId)
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  await screenshot('component-library-search-compact')
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`))
  assert.ok(await evaluate(`(()=>{const input=document.querySelector('[aria-label="Search components"]'),b=input.getBoundingClientRect();return b.width>100&&input===document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)})()`))
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  // Mutations follow the fixed 25-card catalogue assertions above.
  const mutationSnapshot=await evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`),mutationStatus=await status()
  const renamed='Library renamed fixture',duplicateName=`${renamed} copy`
  await click(aria(`Rename component ${fixtures[24].name}`))
  await input(aria(`New name for component ${fixtures[24].name}`),`  ${renamed}  `)
  await click('.component-rename button[type="submit"]')
  await until(`!document.querySelector('.component-rename')`)
  await input(aria('Search components'),renamed)
  assert.equal(await evaluate(`document.querySelector('.component-asset-main strong').textContent`),renamed)
  assert.equal(await evaluate(`document.querySelector('.component-asset').dataset.componentId`),chosenId)
  await click(aria(`Duplicate component ${renamed}`))
  await until(`document.querySelectorAll('.component-asset').length===2`)
  assert.equal(await evaluate(`Number(document.querySelector('.editor-library-tabs button:nth-child(2) span').textContent)`),initial+26)
  const duplicatedId=await evaluate(`Array.from(document.querySelectorAll('.component-asset')).find(card=>card.querySelector('strong').textContent===${JSON.stringify(duplicateName)})?.dataset.componentId`)
  assert.ok(duplicatedId);assert.notEqual(duplicatedId,chosenId)
  const exportAsset=async(name)=>{
    await click(aria(`Export component ${name}`))
    for(let i=0;i<100;i++){
      try{return JSON.parse(await readFile(join(downloads,`${name}.component.json`),'utf8'))}catch{await delay(100)}
    }
    throw new Error(`Missing component export: ${name}`)
  }
  const renamedExport=await exportAsset(renamed),duplicateExport=await exportAsset(duplicateName)
  assert.deepEqual(renamedExport,{...exported,name:renamed})
  assert.equal(duplicateExport.id,duplicatedId)
  const stripIds=(asset)=>({...asset,id:'asset',name:'name',objects:asset.objects.map(function strip(object){return {...object,id:'object',children:object.children.map(strip)}})})
  assert.deepEqual(stripIds(duplicateExport),stripIds(renamedExport))
  const objectIds=(asset)=>{const ids=[];const visit=(objects)=>{for(const object of objects){ids.push(object.id);visit(object.children)}};visit(asset.objects);return ids}
  const sourceIds=new Set([renamedExport.id,...objectIds(renamedExport)])
  assert.ok([duplicateExport.id,...objectIds(duplicateExport)].every(id=>!sourceIds.has(id)))
  assert.equal(new Set([duplicateExport.id,...objectIds(duplicateExport)]).size,objectIds(duplicateExport).length+1)
  assert.equal(await evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`),mutationSnapshot)
  assert.deepEqual(await status(),mutationStatus)
  const mutationOrigin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${mutationOrigin}&&document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await click('.editor-library-tabs button:nth-child(2)');await input(aria('Search components'),renamed)
  assert.equal(await evaluate(`document.querySelectorAll('.component-asset').length`),2)
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.component-asset')).map(card=>card.dataset.componentId).sort()`),[chosenId,duplicatedId].sort())
  assert.equal(await evaluate(`Number(document.querySelector('.editor-library-tabs button:nth-child(2) span').textContent)`),initial+26)
  await screenshot('component-library-renamed-duplicate')
  await click(aria('Clear component search'));await click(aria('Select tool'))
  console.log(JSON.stringify({componentLibraryResult:'passed',checks:['25 component imports through public UI','24-card initial bound and show-more/reset','Vietnamese accent-insensitive name/block AND search','cell sorting','selected asset identity retained','empty search/clear','no document/revision/history changes','unchanged component export','reload persistence','620px search input visible','trimmed rename persists','duplicate fresh IDs preserves cells and source export','rename/duplicate survive reload without document edits']}))
}
