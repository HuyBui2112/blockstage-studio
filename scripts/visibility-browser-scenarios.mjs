import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

export async function runVisibilityScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory}){
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const snapshot=()=>evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const selected=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.selection)`)
  const visible=n=>until(`document.querySelector('.editor-view-diagnostics').dataset.visible==='${n}'`)
  async function view(label){await click('.object-view-menu summary');await click(aria(label))}
  async function select(id){await click(`.outliner-object > button[title=${JSON.stringify(id)}]`)}
  async function vector(prefix,values){for(let i=0;i<3;i++)await input(aria(`${prefix} ${'XYZ'[i]}`),String(values[i]))}
  const cell=(name,pos,properties={})=>({pos,state:{name:`minecraft:${name}`,properties}})
  const object=(id,cells,kind='block',children=[])=>({id,name:id,kind,cells,children,pivot2:[1,1,1],orientation:0})
  const bed=object('bed',[cell('red_bed',[2,0,0],{facing:'south',part:'foot',occupied:'false'}),cell('red_bed',[2,0,1],{facing:'south',part:'head',occupied:'false'})],'multiblock')
  const fixture={schemaVersion:2,id:'view-fixture',name:'View fixture',workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},entities:[],objects:[object('inside',[cell('stone',[0,0,0])]),object('roof',[cell('stone',[0,0,2])]),object('whole-bed',[],'group',[bed]),object('fence',[cell('oak_fence',[5,0,0],{north:'false',east:'false',south:'false',west:'false',waterlogged:'false'})])]}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  const path=join(directory,'view-fixture.json');await writeFile(path,JSON.stringify(fixture));await upload(aria('Import editor document'),path)
  await until(`document.querySelector('[aria-label="Document name"]').value==='View fixture'`)
  if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await click(aria('Select tool'));await visible(5)
  const original=await snapshot(),initial=await status()
  await select('roof');await view('Hide selected');await visible(4);assert.deepEqual(await selected(),[])
  assert.deepEqual(await status(),initial);assert.equal(await snapshot(),original)
  await evaluate(`document.querySelector('canvas').focus()`);await key('KeyA','a');assert.ok(!(await selected()).includes('roof'))
  await view('Show all');await visible(5)
  await select('roof');await view('Lock selected');await visible(5);assert.deepEqual(await selected(),[])
  assert.equal(await evaluate(`document.querySelector('.outliner-object > button[title="roof"]').disabled`),true)
  // Nearest eligible occupied cell: a locked foreground roof does not steal selection.
  await click(aria('Editor Z view'));await click(aria('Frame editor scene'))
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const point=await evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=[.5,.5,3],q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})})
  assert.deepEqual(await selected(),['inside'])
  await view('Unlock all');await select('whole-bed');await view('Isolate selected');await visible(2)
  await screenshot('visibility-isolated-bed')
  assert.equal(await snapshot(),original);assert.deepEqual(await status(),initial)
  await click(aria('Open materials'));assert.match(await evaluate(`document.querySelector('.materials-summary').textContent`),/5 non-air/);await click(aria('Close materials'))
  await view('Exit isolate');await visible(5)
  await select('roof');await view('Hide selected');await visible(4)
  // Hidden geometry is absent from rendering but remains occupied for edits.
  await click(aria('Primitive tools'));await click(aria('Build line'));await vector('Primitive start',[0,0,2]);await vector('Primitive end',[0,0,2])
  await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='false'`)
  assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm primitive action"]').disabled`),true)
  await click(aria('Cancel primitive action'))
  await view('Show all');await select('fence');await view('Lock selected')
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await input(aria('Search resources'),'minecraft:oak_fence');await click('.resource-item[title="minecraft:oak_fence"]')
  await click(aria('Auto connections'));await click(aria('Primitive tools'));await click(aria('Build line'))
  await vector('Primitive start',[6,0,0]);await vector('Primitive end',[6,0,0])
  await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='false'`)
  await until(`document.querySelector('.primitive-action-panel').textContent.includes('Protected object')`)
  await click(aria('Cancel primitive action'));await click(aria('Auto connections'))
  assert.equal(await snapshot(),original);assert.deepEqual(await status(),initial)
  await select('whole-bed');await view('Hide selected');await visible(3)
  const downloads=join(directory,'view-downloads');await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await click(aria('Export editor document'))
  let exported;for(let i=0;i<100;i++){try{exported=JSON.parse(await readFile(join(downloads,'View fixture.blockstage.json'),'utf8'));break}catch{await delay(100)}}
  assert.deepEqual(exported,{...fixture,id:JSON.parse(original).id},'Export retains hidden/locked objects without view flags')
  await click('.document-actions > button.primary');await until(`document.querySelector('.document-saved')`)
  await click(aria('Component Editor workspace'));await until(ready);assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.hidden`),'[]')
  await click(aria('Architecture workspace'));await until(ready);await visible(3)
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`);await visible(5)
  assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.locked`),'[]')
  assert.equal(await snapshot(),original)
  // New roots join the active isolated view; Undo/Redo keeps them visible correctly.
  if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await select('whole-bed');await view('Isolate selected');await visible(2)
  await click(aria('Primitive tools'));await click(aria('Build line'));await vector('Primitive start',[8,0,0]);await vector('Primitive end',[8,0,0])
  await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='true'`)
  await click(aria('Confirm primitive action'));await visible(3)
  assert.equal((await selected()).length,1)
  await click(aria('Undo editor'));await visible(2)
  await click(aria('Redo editor'));await visible(3)
  await click(aria('Undo editor'));await visible(2);await view('Reset view');await visible(5)
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  await click('.object-view-menu summary');await screenshot('visibility-menu-compact')
  assert.ok(await evaluate(`(()=>{const b=document.querySelector('.object-view-menu > div').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.bottom<=innerHeight})()`))
  await click('.object-view-menu summary');await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  console.log(JSON.stringify({visibilityResult:'passed',checks:['hide/show no revision/history changes','whole paired group isolation','locked geometry visible but nearest eligible ray selection','select-all/outliner eligibility','hidden occupancy rejects collision','locked neighbor auto-update rejected before commit','full counts/export despite hidden/locked','workspace independence and reload reset','620px menu']}))
}
