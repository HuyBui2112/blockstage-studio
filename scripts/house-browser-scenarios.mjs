import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {gunzipSync,strFromU8} from 'fflate'

// Deliberately independent of the editor's planners and NBT writer.
export function readHouseStructure(compressed){
  const bytes=gunzipSync(compressed),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  let cursor=0
  const byte=()=>view.getUint8(cursor++)
  const integer=()=>{const n=view.getInt32(cursor);cursor+=4;return n}
  const text=()=>{const n=view.getUint16(cursor);cursor+=2;const s=strFromU8(bytes.subarray(cursor,cursor+n));cursor+=n;return s}
  function tag(type){
    if(type===3)return integer()
    if(type===8)return text()
    if(type===9){const item=byte(),n=integer();assert.ok(n>=0&&n<=110592);return Array.from({length:n},()=>tag(item))}
    if(type===10){const result={};for(let child=byte();child!==0;child=byte()){const name=text();result[name]=tag(child)}return result}
    throw new Error(`Unexpected house NBT tag ${type}`)
  }
  assert.equal(byte(),10);assert.equal(text(),'');const result=tag(10);assert.equal(cursor,bytes.length);return result
}
const sorted=cells=>cells.map(({pos,state})=>({pos,state})).sort((a,b)=>a.pos.join(',').localeCompare(b.pos.join(',')))
const flatten=objects=>objects.flatMap(object=>[...object.cells,...flatten(object.children)])
const materialCells=(positions,name)=>positions.map(pos=>({pos,state:{name:`minecraft:${name}`,properties:{}}}))

/** Build from empty using public UI only; no document import or storage/action injection. */
export async function runHouseScenarios({command,evaluate,until,click,aria,input,key,screenshot,directory}){
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const snapshot=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`)
  const valid=kind=>until(`document.querySelector('.${kind}-action-diagnostics')?.dataset.valid==='true'`)
  const ghost=kind=>evaluate(`JSON.parse(document.querySelector('.${kind}-action-diagnostics').dataset.snapshot)`)
  const noPrimitive=()=>until(`!document.querySelector('.primitive-action-panel')`)
  const noMaterial=()=>until(`!document.querySelector('[aria-label="Confirm material replacement"]')`)
  const newDocument=async()=>{await click('.document-actions > button[title="Save current draft, then create a new document"]');await until(`(${ready})&&document.querySelector('.editor-diagnostics').dataset.blocks==='0'`)}
  async function vector(prefix,values){for(let i=0;i<3;i++)await input(aria(`${prefix} ${'XYZ'[i]}`),String(values[i]))}
  async function selectAll(){await click(aria('Select tool'));await focus();await key('KeyA','a');await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.selection).length===Number(document.querySelector('.editor-diagnostics').dataset.objects)`)}
  async function menu(action){await click(aria('Copy tools'));await click(aria(`${action} objects`))}
  async function save(name){await evaluate("document.querySelector('[aria-label=\"Document name\"]') .focus()");await input(aria('Document name'),name);await focus();await click(aria('Frame editor scene'));await until(`document.querySelector('[aria-label="Document name"]').defaultValue===${JSON.stringify(name)}`);await click('.document-actions > button.primary');await until(`document.querySelector('.document-saved')`)}
  async function open(id){await click(aria('Manage editor documents'));await until(`document.querySelector('.documents-content')?.getAttribute('aria-busy')==='false'`);await click(`.saved-document[data-document-id=${JSON.stringify(id)}] .saved-document-open`);await until(`!document.querySelector('.documents-dialog')&&document.querySelector('.editor-diagnostics').dataset.document===${JSON.stringify(id)}`)}
  const downloads=join(directory,'house-downloads');await mkdir(downloads,{recursive:true})
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  async function downloaded(name){for(let i=0;i<100;i++){try{return await readFile(join(downloads,name))}catch{await delay(100)}}throw new Error(`Missing house download ${name}`)}
  const results=[]
  async function verifySaved(name,material){
    const expected=materialCells(positions,material),id=(await snapshot()).id
    await save(name)
    const previous=await evaluate('performance.timeOrigin');await command('Page.reload')
    await until(`performance.timeOrigin!==${previous}&&(${ready})`)
    assert.equal((await snapshot()).id,id);assert.deepEqual(sorted((await snapshot()).cells),sorted(expected))
    await newDocument();await open(id)
    assert.deepEqual(sorted((await snapshot()).cells),sorted(expected),'Catalogue reopen retains the complete house')
    await click(aria('Export editor document'))
    const document=JSON.parse((await downloaded(`${name}.blockstage.json`)).toString())
    assert.equal(document.id,id);assert.equal(document.name,name);assert.equal(document.schemaVersion,2)
    assert.deepEqual(document.target,{gameVersion:'26.2',dataVersion:4903});assert.deepEqual(document.entities,[])
    assert.deepEqual(sorted(flatten(document.objects)),sorted(expected))
    await click(aria('Export Minecraft'));await until(`document.querySelector('[aria-label="Download Minecraft export"]')?.disabled===false`)
    await input(aria('Export format'),'nbt');await click(aria('Download Minecraft export'))
    // The writer's download stem is shown by its own public filename contract.
    const nbtName=await evaluate(`document.querySelector('.export-footer code').textContent`)
    const nbt=readHouseStructure(await downloaded(nbtName))
    assert.equal(nbt.DataVersion,4903);assert.deepEqual(nbt.size,[4,4,4]);assert.deepEqual(nbt.entities,[])
    assert.deepEqual(sorted(nbt.blocks.map(block=>({pos:block.pos,state:{name:nbt.palette[block.state].Name,properties:nbt.palette[block.state].Properties??{}}}))),sorted(expected))
    await click(aria('Close Export Minecraft'));await click(aria('Frame editor scene'))
    await screenshot(`house-${material}-desktop`)
    await focus();await key('Numpad1','1',2);await key('Numpad4','4');await key('Numpad8','8')
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await screenshot(`house-${material}-entrance`)
    await writeFile(resolve(`artifacts/house-${material}.nbt`),await downloaded(nbtName))
    await writeFile(resolve(`artifacts/house-${material}.expected.json`),JSON.stringify({size:[4,4,4],blocks:sorted(expected)},null,2))
    results.push({name,id,material,cells:expected.length,export:'JSON and independently decoded NBT'})
    return id
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready);await newDocument()
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await input(aria('Search resources'),'minecraft:oak_planks');await click('.resource-item[title="minecraft:oak_planks"]')
  // Independent six-surface enumeration: 16 floor + 16 roof + 22 wall cells.
  // Interior x/z=1..2, y=1..2 is empty; entrance x=1,z=0,y=1..2 is empty.
  const positions=[]
  for(let y=0;y<=3;y++)for(let z=0;z<=3;z++)for(let x=0;x<=3;x++){
    if(y===0||y===3||((x===0||x===3||z===0||z===3)&&!(x===1&&z===0)))positions.push([x,y,z])
  }
  assert.equal(positions.length,54)
  const parts=[['plane',[0,0,0],[3,0,3]],['plane',[0,1,0],[0,2,3]],['plane',[3,1,0],[3,2,3]],['plane',[1,1,3],[2,2,3]],['line',[2,1,0],[2,2,0]],['plane',[0,3,0],[3,3,3]]]
  let built=[]
  for(const [kind,start,end] of parts){
    await click(aria('Primitive tools'));await click(aria(`Build ${kind}`));await vector('Primitive start',start);await vector('Primitive end',end);await valid('primitive')
    const expected=[];for(let y=start[1];y<=end[1];y++)for(let z=start[2];z<=end[2];z++)for(let x=start[0];x<=end[0];x++)expected.push([x,y,z])
    const before=await snapshot(),beforeStatus=await status()
    assert.deepEqual(sorted((await ghost('primitive')).cells),sorted(materialCells(expected,'oak_planks')))
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await status(),beforeStatus)
    await click(aria('Confirm primitive action'));await noPrimitive();built=built.concat(expected)
    assert.deepEqual(sorted((await snapshot()).cells),sorted(materialCells(built,'oak_planks')))
    assert.equal(Number((await status()).history),Number(beforeStatus.history)+1)
  }
  assert.deepEqual(sorted((await snapshot()).cells),sorted(materialCells(positions,'oak_planks')))
  const oak=await verifySaved('House oak','oak_planks')
  let source='oak_planks'
  for(const target of ['spruce_planks','birch_planks']){
    await selectAll();await menu('Copy');await newDocument();await menu('Paste');await vector('Paste position',[0,0,0]);await valid('copy')
    await click(aria('Confirm copy action'));await until(`!document.querySelector('[aria-label="Paste preview"]')`)
    await selectAll();await click(aria('Open materials'))
    assert.match(await evaluate(`document.querySelector('.materials-summary').textContent`),/54 non-air · 0 explicit air/)
    await input(aria('Materials count scope'),'selection')
    assert.match(await evaluate(`document.querySelector('.materials-summary').textContent`),/54 non-air · 0 explicit air/)
    await input(aria('Replacement source material'),`minecraft:${source}`);await input(aria('Replacement target material'),`minecraft:${target}`)
    const before=await snapshot(),beforeStatus=await status()
    await click(aria('Preview material replacement'));await valid('material')
    assert.equal((await ghost('material')).matchedCells,54)
    assert.deepEqual(sorted((await ghost('material')).cells),sorted(materialCells(positions,target)))
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await status(),beforeStatus)
    await click(aria('Cancel material replacement'));await noMaterial();assert.deepEqual(await snapshot(),before);assert.deepEqual(await status(),beforeStatus)
    await click(aria('Preview material replacement'));await valid('material')
    await screenshot(`house-${target}-replacement`)
    await click(aria('Confirm material replacement'));await noMaterial();await click(aria('Close materials'))
    assert.deepEqual(sorted((await snapshot()).cells),sorted(materialCells(positions,target)))
    assert.equal(Number((await status()).history),Number(beforeStatus.history)+1)
    await click(aria('Undo editor'));assert.deepEqual(await snapshot(),before)
    await click(aria('Redo editor'));assert.deepEqual(sorted((await snapshot()).cells),sorted(materialCells(positions,target)))
    await verifySaved(`House ${target.split('_')[0]}`,target);source=target
  }
  assert.equal(new Set(results.map(result=>result.id)).size,3,'All variants have independent Saved IDs')
  for(const result of results){await open(result.id);assert.deepEqual(sorted((await snapshot()).cells),sorted(materialCells(positions,result.material)))}
  await open(oak);await click(aria('Frame editor scene'))
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  if(await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  if(await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await focus();await key('Numpad1','1',2);await key('Numpad4','4');await key('Numpad8','8');await click(aria('Frame editor scene'))
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await screenshot('house-complete-compact')
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),'House editor fits compact width')
  assert.ok(await evaluate(`(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.tagName==='CANVAS'})()`),'Compact room viewport is unobscured after closing panels')
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  const report={houseResult:'passed',geometry:{bounds:[4,4,4],floor:16,roof:16,walls:22,total:54,interior:[2,2,2],entrance:[1,2]},variants:results,checks:['empty New and palette selection','six native UI primitives','independent exact coordinates/states','material preview/cancel and one Undo/Redo','clipboard copies with fresh Saved IDs','Save/reload/catalogue reopen','complete JSON and independently decoded NBT','original and variants retained','desktop and compact screenshots'],limits:['scripted small one-room journey; not participant usability evidence','software browser rendering; not real GPU performance','NBT data verification; not Minecraft world readback']}
  await writeFile(resolve('artifacts/house-workflow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
