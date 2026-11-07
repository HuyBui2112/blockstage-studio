import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

/** Native controls and full JSON downloads; geometric editing evidence, not world parity. */
export async function runMirrorScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory,profilePath}) {
  const profile=JSON.parse(await readFile(profilePath,'utf8'))
  const name='Mirror building fixture',downloads=join(directory,'mirror-downloads')
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const cell=(id,pos,properties={})=>({pos,state:{name:`minecraft:${id}`,properties:{...profile.blocks.find(block=>block.id===`minecraft:${id}`).defaults,...properties}}})
  const leaf=(id,cells)=>({id,name:id,kind:cells.length===1?'block':'multiblock',cells,children:[],pivot2:cells[0].pos.map(v=>2*v+1),orientation:1})
  const module={id:'mirror-module',name:'Mirror module',kind:'component',componentId:'library-mirror-module',cells:[],children:[
    leaf('mirror-log',[cell('oak_log',[1,0,0],{axis:'x'})]),
    leaf('mirror-stair',[cell('oak_stairs',[3,0,0],{facing:'east',shape:'inner_left'})]),
    leaf('mirror-door',[cell('oak_door',[5,0,0],{facing:'east',half:'lower',hinge:'left'}),cell('oak_door',[5,1,0],{facing:'east',half:'upper',hinge:'left'})]),
    leaf('mirror-bed',[cell('red_bed',[7,0,1],{facing:'north',part:'foot'}),cell('red_bed',[7,0,0],{facing:'north',part:'head'})]),
    leaf('mirror-chest',[{...cell('chest',[9,0,0],{facing:'west',type:'single'}),blockEntity:{kind:'chest',items:[{slot:0,id:'minecraft:stone',count:64},{slot:26,id:'minecraft:iron_ingot',count:3}]}}]),
  ],pivot2:[3,1,1],orientation:1}
  const root={id:'mirror-group',name:'Mirror group',kind:'group',cells:[],children:[module],pivot2:[1,1,1],orientation:0}
  const document={schemaVersion:2,id:'mirror-fixture',name,workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[root],entities:[]}
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const snapshot=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const disabled=()=>evaluate(`document.querySelector('[aria-label="Confirm mirror action"]').disabled`)
  const absent=()=>until(`!document.querySelector('[aria-label="Mirror preview"]')`)
  async function save(){await click('.document-actions > button.primary');await until(`!!document.querySelector('.document-saved')`)}
  async function exported(){await unlink(join(downloads,`${name}.blockstage.json`)).catch(error=>{if(error.code!=='ENOENT')throw error});await click(aria('Export editor document'));for(let i=0;i<100;i++){try{return JSON.parse(await readFile(join(downloads,`${name}.blockstage.json`),'utf8'))}catch{await delay(100)}}throw new Error('Missing Mirror JSON download')}
  async function imported(value){const path=join(directory,'mirror-fixture.json');await writeFile(path,JSON.stringify(value));await upload(aria('Import editor document'),path);await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(name)}`);await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.length===${value.objects.reduce((n,o)=>n+count(o),0)}`)}
  function count(object){return object.cells.length+object.children.reduce((n,o)=>n+count(o),0)}
  async function select(id){await click(aria('Select tool'));if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'));await click(`.outliner-object > button[title=${JSON.stringify(id)}]`)}
  async function mirror(plane='yz',pivot='custom'){await click(aria('Mirror selection'));await until(`!!document.querySelector('[aria-label="Mirror preview"]')`);await input(aria('Mirror plane'),plane);await input(aria('Mirror pivot'),pivot);if(pivot==='custom')await input(aria('Mirror plane coordinate'),'0')}
  async function stableValid(){await until(`document.querySelector('[aria-label="Confirm mirror action"]')?.disabled===false`);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')}
  function reflect(object,axis){const properties=(p)=>{const next={...p},[a,b]=axis===0?['east','west']:['north','south'];if(next.facing===a)next.facing=b;else if(next.facing===b)next.facing=a;if(next.hinge)next.hinge=next.hinge==='left'?'right':'left';if(next.shape==='inner_left')next.shape='inner_right';else if(next.shape==='inner_right')next.shape='inner_left';return next};return {...object,cells:object.cells.map(c=>({...c,pos:c.pos.map((v,i)=>i===axis?-v-1:v),state:{...c.state,properties:properties(c.state.properties)}})),children:object.children.map(c=>reflect(c,axis)),pivot2:object.pivot2.map((v,i)=>i===axis?-v:v),orientation:(axis===0?4-object.orientation:6-object.orientation)%4}}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`)
  await imported(document);await select(root.id);const before=await exported(),initial=await snapshot(),initialStatus=await status()
  await mirror();await stableValid();assert.deepEqual(await snapshot(),initial);assert.deepEqual(await status(),initialStatus)
  await input(aria('Mirror plane coordinate'),'.25');await until(`document.querySelector('[aria-label="Confirm mirror action"]').disabled===true`)
  await key('Enter','Enter');assert.equal(await disabled(),true);assert.deepEqual(await status(),initialStatus)
  await click(aria('Cancel mirror action'));await absent();assert.deepEqual((await exported()).objects,before.objects)
  // Every pivot selector must remain usable without leaking a custom coordinate.
  await mirror('xy');for(const pivot of ['selection','active','individual','custom']){await input(aria('Mirror pivot'),pivot);await stableValid()}
  await input(aria('Mirror plane coordinate'),'0');await screenshot('mirror-xy-preview');assert.deepEqual(await snapshot(),initial)
  await click(aria('Cancel mirror action'));await absent()
  await mirror();await stableValid();await screenshot('mirror-yz-preview');await click(aria('Confirm mirror action'));await absent()
  assert.deepEqual((await exported()).objects,before.objects.map(o=>reflect(o,0)))
  assert.equal(Number((await status()).history),Number(initialStatus.history)+1)
  await click(aria('Undo editor'));assert.deepEqual((await exported()).objects,before.objects)
  await click(aria('Redo editor'));assert.deepEqual((await exported()).objects,before.objects.map(o=>reflect(o,0)))
  await mirror();await stableValid();await click(aria('Confirm mirror action'));await absent();assert.deepEqual((await exported()).objects,before.objects,'Two identical geometric mirrors restore every stored object field')
  await mirror('xy');await stableValid();await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false});await screenshot('mirror-compact')
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('[aria-label="Mirror preview"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true)
  await click(aria('Confirm mirror action'));await absent();assert.deepEqual((await exported()).objects,before.objects.map(o=>reflect(o,2)))
  await click(aria('Undo editor'));await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await save()
  const observer=leaf('unsupported-observer',[cell('observer',[20,0,0])]);await imported({...document,id:'mirror-unsupported',objects:[observer]});await select(observer.id)
  const unsupported=await snapshot(),unsupportedStatus=await status();await mirror();await until(`document.querySelector('[aria-label="Confirm mirror action"]').disabled===true`);assert.deepEqual(await snapshot(),unsupported);await click(aria('Cancel mirror action'));await absent();assert.deepEqual(await status(),unsupportedStatus)
  await save()
  const blocker=leaf('mirror-blocker',[cell('stone',[-2,0,0])]);await imported({...document,id:'mirror-collision',objects:[root,blocker]});await select(root.id)
  const collision=await snapshot(),collisionStatus=await status();await mirror();await until(`document.querySelector('[aria-label="Confirm mirror action"]').disabled===true`);assert.deepEqual(await snapshot(),collision);await click(aria('Cancel mirror action'));await absent();assert.deepEqual(await status(),collisionStatus)
  await save()
  console.log(JSON.stringify({mirrorResult:'passed',checks:['whole group/component mirror','stair chirality and door hinge','complete door/bed pairs','chest payload and IDs/provenance preserved','YZ and XY custom plane geometry','preview/cancel keep document unchanged','fractional grid rejection','all pivot modes','atomic Undo/Redo and double mirror identity','unsupported observer and collision rejection','620px panel'],limits:['scripted browser geometric editing; no Minecraft world readback']}))
}
