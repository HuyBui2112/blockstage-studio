import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function runBuildingToolsScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory}) {
  const diag='.editor-diagnostics'
  const snapshot=()=>evaluate(`JSON.parse(document.querySelector('${diag}').dataset.snapshot)`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('${diag}').dataset;return {revision:d.revision,history:d.history}})()`)
  const valid=(selector,value=true)=>until(`document.querySelector('${selector}')?.dataset.valid==='${value}'`)
  const ghost=()=>evaluate(`JSON.parse(document.querySelector('.primitive-action-diagnostics').dataset.snapshot)`)
  const absent=()=>until(`!document.querySelector('.primitive-action-panel')&&!document.querySelector('.copy-action-panel')`)
  async function build(kind){await click(aria('Primitive tools'));await click(aria(`Build ${kind}`));await until(`!!document.querySelector('.primitive-action-panel')`);await input(aria('Primitive sizing mode'),'dimensions')}
  async function vector(prefix,values){for(let i=0;i<3;i++)await input(aria(`${prefix} ${'XYZ'[i]}`),String(values[i]))}
  async function library(){if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))}
  async function hover(){const p=await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+r.width*.8,y:r.y+r.height*.75}})()`);await command('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  await click('.document-actions > button[title="Save current draft, then create a new document"]');await until(`document.querySelector('${diag}').dataset.blocks==='0'`)
  await library();await input(aria('Search resources'),'minecraft:stone');await click('.resource-item[title="minecraft:stone"]')
  const initial=await status()
  await build('hollow box');await vector('Primitive start',[-2,0,-2]);await vector('Primitive size',[4,3,5]);await valid('.primitive-action-diagnostics')
  const room=await ghost();assert.equal(room.cells.length,54);assert.ok(!room.cells.some(c=>c.pos.join(',')==='-1,1,-1'))
  await hover();assert.deepEqual(await ghost(),room,'Pointer cannot overwrite numeric dimensions')
  for(const value of ['0','-1','1.5']){await input(aria('Primitive size X'),value);await valid('.primitive-action-diagnostics',false);assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm primitive action"]').disabled`),true);await key('Enter','Enter');assert.deepEqual(await status(),initial)}
  await input(aria('Primitive size X'),'4');await valid('.primitive-action-diagnostics');await screenshot('building-dimensions-room')
  await click(aria('Confirm primitive action'));await absent();assert.deepEqual((await snapshot()).cells,room.cells)
  await click(aria('Frame editor scene'));await screenshot('building-sized-room-committed')
  assert.equal(Number((await status()).history),Number(initial.history)+1)
  await click(aria('Undo editor'));await until(`document.querySelector('${diag}').dataset.blocks==='0'`)
  await click(aria('Redo editor'));assert.deepEqual((await snapshot()).cells,room.cells)
  await click(aria('Undo editor'))
  await build('line');await vector('Primitive start',[0,0,0]);await input(aria('Primitive line axis'),'y');await input(aria('Primitive size Y'),'4');await input(aria('Primitive direction Y'),'-1');await valid('.primitive-action-diagnostics')
  assert.deepEqual((await ghost()).cells.map(c=>c.pos),[[0,-3,0],[0,-2,0],[0,-1,0],[0,0,0]])
  await click(aria('Cancel primitive action'));await absent()
  await build('plane');await vector('Primitive start',[0,0,0]);await input(aria('Primitive plane'),'yz');await input(aria('Primitive size Y'),'2');await input(aria('Primitive size Z'),'3');await valid('.primitive-action-diagnostics')
  assert.equal((await ghost()).cells.length,6);assert.ok((await ghost()).cells.every(c=>c.pos[0]===0))
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false});await screenshot('building-dimensions-compact')
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('.primitive-action-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true)
  await click(aria('Cancel primitive action'));await absent();await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})

  const cell=(pos)=>({pos,state:{name:'minecraft:oak_log',properties:{axis:'x'}}})
  const leaf=(id,pos)=>({id,name:id,kind:'block',cells:[cell(pos)],children:[],pivot2:pos.map(v=>2*v+1),orientation:0})
  const component={id:'module',name:'Beam module',kind:'component',componentId:'library-beam',cells:[],children:[leaf('log-a',[0,0,0]),leaf('log-b',[1,0,0])],pivot2:[1,1,1],orientation:0}
  const fixture={schemaVersion:2,id:'building-grid',name:'Building grid',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[component],entities:[]}
  const path=join(directory,'building-grid.json');await writeFile(path,JSON.stringify(fixture));await upload(aria('Import editor document'),path)
  await until(`document.querySelector('[aria-label="Document name"]').value==='Building grid'`)
  if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await click(aria('Select tool'));await click('.outliner-object > button[title="module"]')
  const source=await snapshot(),sourceStatus=await status()
  async function grid(){await click(aria('Copy tools'));await click(aria('Repeat grid objects'));await until(`!!document.querySelector('[aria-label="Repeat grid preview"]')`)}
  await grid();await vector('Grid spacing',[3,3,4]);await vector('Grid count',[2,2,2]);await valid('.copy-action-diagnostics')
  const gridState=()=>evaluate(`JSON.parse(document.querySelector('.copy-action-diagnostics').dataset.snapshot)`)
  const first=await gridState();await hover();assert.deepEqual(await gridState(),first,'Grid pointer does not change numeric pattern')
  for(const count of ['0','100000000']){await input(aria('Grid count X'),count);await valid('.copy-action-diagnostics',false);assert.deepEqual(await snapshot(),source);assert.deepEqual(await status(),sourceStatus)}
  await input(aria('Grid count X'),'2');await input(aria('Grid spacing X'),'1');await valid('.copy-action-diagnostics',false)
  await input(aria('Grid spacing X'),'3');await valid('.copy-action-diagnostics');assert.deepEqual(await gridState(),first,'Numeric revisions reuse stable copy IDs')
  await screenshot('building-repeat-grid');await click(aria('Cancel copy action'));await absent();assert.deepEqual(await snapshot(),source)
  await grid();await vector('Grid spacing',[3,3,4]);await vector('Grid count',[2,2,2]);await valid('.copy-action-diagnostics')
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false});await screenshot('building-repeat-grid-compact')
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('.copy-action-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true)
  await click(aria('Confirm copy action'));await absent();assert.equal((await snapshot()).cells.length,16)
  await click(aria('Frame editor scene'));await screenshot('building-grid-committed')
  assert.equal(Number((await status()).history),Number(sourceStatus.history)+1)
  await click(aria('Undo editor'));assert.deepEqual(await snapshot(),source)
  await click(aria('Redo editor'));assert.equal((await snapshot()).cells.length,16)
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  const downloads=join(directory,'building-downloads');await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await click(aria('Export editor document'));let exported
  for(let n=0;n<100;n++){try{exported=JSON.parse(await readFile(join(downloads,'Building grid.blockstage.json'),'utf8'));break}catch{await delay(100)}}
  assert.equal(exported.objects.length,8);assert.deepEqual(exported.objects[0],component)
  assert.equal(new Set(exported.objects.flatMap(root=>[root.id,...root.children.map(child=>child.id)])).size,24)
  const expected=[];for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++)expected.push([x*3,y*3,z*4])
  for(const [i,root]of exported.objects.entries()){assert.equal(root.componentId,'library-beam');assert.deepEqual(root.children.map(child=>child.cells[0].pos),[expected[i],[expected[i][0]+1,expected[i][1],expected[i][2]]])}
  await click('.document-actions > button.primary');await until(`!!document.querySelector('.document-saved')`)
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  assert.equal((await snapshot()).cells.length,16)
  console.log(JSON.stringify({buildingToolsResult:'passed',checks:['inclusive signed dimensions','invalid size retires preview','line/plane World orientation','numeric pointer isolation','hollow interior preserved','2D/3D whole component grid','collision and aggregate count rejection','fresh stable nested IDs/provenance','cancel and atomic Undo/Redo','full JSON and Save/reload','620px panels']}))
}
