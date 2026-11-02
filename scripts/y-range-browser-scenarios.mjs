import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function runYRangeScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory}){
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const snapshot=()=>evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const visible=n=>until(`document.querySelector('.editor-view-diagnostics').dataset.visible==='${n}'`)
  const selection=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.selection)`)
  async function menu(){if(!await evaluate(`document.querySelector('.object-view-menu').open`))await click(aria('View tools'))}
  async function range(min,max){await menu();await input(aria('Show Y min'),String(min));await input(aria('Show Y max'),String(max));await click(aria('Apply Y range'))}
  async function vector(field,values){for(let i=0;i<3;i++)await input(aria(`${field} ${'XYZ'[i]}`),String(values[i]))}
  const cell=(name,pos,properties={})=>({pos,state:{name:`minecraft:${name}`,properties}})
  const object=(id,cells,kind='block',children=[])=>({id,name:id,kind,cells,children,pivot2:[1,1,1],orientation:0})
  const doorProperties={facing:'north',hinge:'left',open:'false',powered:'false'}
  const fixture={schemaVersion:2,id:'y-range',name:'Y range fixture',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},entities:[],objects:[object('inside',[cell('stone',[0,0,0])]),object('roof',[cell('stone',[0,2,0])]),object('door',[cell('oak_door',[2,0,0],{...doorProperties,half:'lower'}),cell('oak_door',[2,1,0],{...doorProperties,half:'upper'})],'multiblock'),object('group',[],'group',[object('lower',[cell('stone',[4,0,0])]),object('upper',[cell('stone',[4,2,0])])]),object('negative',[cell('stone',[6,-1,0])])]}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  const path=join(directory,'y-range.json');await writeFile(path,JSON.stringify(fixture));await upload(aria('Import editor document'),path)
  await until(`document.querySelector('[aria-label="Document name"]').value==='Y range fixture'`)
  if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await click(aria('Select tool'));await visible(7)
  const original=await snapshot(),initial=await status()
  await range(0,0);await visible(3)
  for(const id of ['roof','door','group','negative'])assert.equal(await evaluate(`document.querySelector('.outliner-object > button[title="${id}"]').disabled`),true)
  await evaluate(`document.querySelector('canvas').focus()`);await key('KeyA','a');assert.deepEqual(await selection(),['inside'])
  assert.equal(await snapshot(),original);assert.deepEqual(await status(),initial)
  await click(aria('Frame editor scene'));await click(aria('Editor Z view'));await screenshot('y-range-partial-door')
  await menu();await input(aria('Show Y min'),'2');await input(aria('Show Y max'),'0');await click(aria('Apply Y range'))
  await until(`document.querySelector('.object-view-menu [role="alert"]')`)
  await visible(3);assert.equal(await snapshot(),original);assert.deepEqual(await status(),initial)
  await range(0,1);await visible(4)
  assert.equal(await evaluate(`document.querySelector('.outliner-object > button[title="door"]').disabled`),false)
  await click('.outliner-object > button[title="door"]');await menu();await click(aria('Focus selected Y'));await visible(4)
  assert.deepEqual(await evaluate(`JSON.parse(document.querySelector('.editor-view-diagnostics').dataset.yRange)`),{min:0,max:1})
  await range(-1,-1);await visible(1)
  await evaluate(`document.querySelector('canvas').focus()`);await key('KeyA','a');assert.deepEqual(await selection(),['negative'])
  // Out-of-range new objects cannot be committed even if their cells are empty.
  await range(0,0);await click(aria('Primitive tools'));await click(aria('Build line'));await vector('Primitive start',[8,2,0]);await vector('Primitive end',[8,2,0])
  await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='false'`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm primitive action"]').disabled`),true)
  await click(aria('Cancel primitive action'));assert.equal(await snapshot(),original)
  // Full document counts/export retain both halves and hidden floors/roof.
  await click(aria('Open materials'));assert.match(await evaluate(`document.querySelector('.materials-summary').textContent`),/7 non-air/);await click(aria('Close materials'))
  const downloads=join(directory,'y-range-downloads');await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await click(aria('Export editor document'));let exported
  for(let i=0;i<100;i++){try{exported=JSON.parse(await readFile(join(downloads,'Y range fixture.blockstage.json'),'utf8'));break}catch{await delay(100)}}
  assert.deepEqual(exported,{...fixture,id:JSON.parse(original).id})
  await menu();await click(aria('Clear Y range'));await visible(7)
  await range(2,2);await visible(2)
  await click(aria('Component Editor workspace'));await until(ready)
  assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.yRange`),'null')
  await click(aria('Architecture workspace'));await until(ready);await visible(2)
  await click('.document-actions > button.primary');await until(`document.querySelector('.document-saved')`)
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`);await visible(7)
  assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.yRange`),'null')
  assert.equal(await snapshot(),original)
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  await menu();await screenshot('y-range-menu-compact')
  assert.ok(await evaluate(`(()=>{const p=document.querySelector('.object-view-menu > div'),b=p.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&p.scrollHeight>=p.clientHeight})()`))
  await click(aria('View tools'));await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  console.log(JSON.stringify({yRangeResult:'passed',checks:['inclusive positive/negative ranges','partial door/group protected and selected roots pruned','invalid range preserves view/document/history','selected Y bounds','out-of-range new primitive rejected','full counts/JSON export','workspace independence/reload reset','620px range menu']}))
}
