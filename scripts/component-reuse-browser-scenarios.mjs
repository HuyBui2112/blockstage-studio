import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {readHouseStructure} from './house-browser-scenarios.mjs'

const flatten=objects=>objects.flatMap(object=>[...object.cells,...flatten(object.children)])
const sorted=cells=>cells.map(({pos,state})=>({pos,state})).sort((a,b)=>a.pos.join(',').localeCompare(b.pos.join(',')))
const ids=objects=>objects.flatMap(object=>[object.id,...ids(object.children)])

/** Public UI authoring and real pointer placement; downloads inspect complete data. */
export async function runComponentReuseScenarios({command,evaluate,until,click,aria,input,key,screenshot,directory,profilePath}){
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const assetName='Reusable log bench',name='Component two floors',downloads=join(directory,'component-reuse-downloads')
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const profile=JSON.parse(await readFile(profilePath,'utf8'))
  const cell=(id,pos,properties={})=>({pos,state:{name:`minecraft:${id}`,properties:{...profile.blocks.find(block=>block.id===`minecraft:${id}`).defaults,...properties}}})
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  async function downloaded(filename){for(let i=0;i<100;i++){try{return await readFile(join(downloads,filename))}catch{await delay(100)}}throw new Error(`Missing component reuse download ${filename}`)}
  async function download(label,filename){await unlink(join(downloads,filename)).catch(error=>{if(error.code!=='ENOENT')throw error});await click(aria(label));return JSON.parse((await downloaded(filename)).toString())}
  const documentJSON=()=>download('Export editor document',`${name}.blockstage.json`)
  const assetJSON=()=>download(`Export component ${assetName}`,`${assetName}.component.json`)
  async function verify(expected){const document=await documentJSON();assert.deepEqual(sorted(flatten(document.objects)),sorted(expected));return document}
  async function newDocument(){await click('.document-actions > button[title="Save current draft, then create a new document"]');await until(`(${ready})&&document.querySelector('.editor-diagnostics').dataset.blocks==='0'`)}
  async function rename(value){await evaluate(`document.querySelector('[aria-label="Document name"]').focus()`);await input(aria('Document name'),value);await focus();await click(aria('Frame editor scene'));await until(`document.querySelector('[aria-label="Document name"]').defaultValue===${JSON.stringify(value)}`)}
  async function library(){if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))}
  async function palette(id){await library();await click('.editor-library-tabs button:first-child');await input(aria('Search resources'),`minecraft:${id}`);await click(`.resource-item[title="minecraft:${id}"]`)}
  async function build(kind,start,end){await click(aria('Primitive tools'));await click(aria(`Build ${kind}`));for(const [prefix,values] of [['Primitive start',start],['Primitive end',end]])for(let i=0;i<3;i++)await input(aria(`${prefix} ${'XYZ'[i]}`),String(values[i]));await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='true'`);await click(aria('Confirm primitive action'));await until(`!document.querySelector('.primitive-action-panel')`)}
  async function range(min,max){if(!await evaluate(`document.querySelector('.object-view-menu').open`))await click(aria('View tools'));await input(aria('Show Y min'),String(min));await input(aria('Show Y max'),String(max));await click(aria('Apply Y range'))}
  async function select(id){await click(aria('Select tool'));if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'));while(!await evaluate(`!!document.querySelector('.outliner-object > button[title=${JSON.stringify(id)}]')`))await click('.outliner .load-more');await click(`.outliner-object > button[title=${JSON.stringify(id)}]`)}
  async function move(finish){await focus();await key('KeyG','g');await key('KeyX','x');await key('Digit1','1');await until(`document.querySelector('.transform-hud')`);await key(finish==='cancel'?'Escape':'Enter',finish==='cancel'?'Escape':'Enter');await until(`!document.querySelector('.transform-hud')`)}
  async function place(y,turns,expected){
    if(!await evaluate(`document.querySelector('.object-view-menu').open`))await click(aria('View tools'))
    if(!await evaluate(`document.querySelector('[aria-label="Clear Y range"]').disabled`))await click(aria('Clear Y range'))
    await library();await click('.editor-library-tabs button:nth-child(2)')
    await evaluate(`Array.from(document.querySelectorAll('.component-asset-main')).find(button=>button.textContent.includes(${JSON.stringify(assetName)})).click()`)
    await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await range(y,y+1);await input(aria('Placement grid Y'),String(y));await evaluate("Array.from(document.querySelectorAll('.component-asset-main')).find(button=>button.textContent.includes('Reusable log bench')).click()");await focus()
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    const point=await evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=[1.5,${y},1.5],q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await until(`document.querySelector('.editor-placement-diagnostics').dataset.valid==='true'`)
    for(let i=0;i<turns;i++)await key('KeyR','r')
    await until(`document.querySelector('.editor-workspace').dataset.placementTurns==='${turns}'`)
    const candidate=await evaluate(`JSON.parse(document.querySelector('.editor-placement-diagnostics').dataset.snapshot).cells`)
    assert.deepEqual(sorted(candidate),sorted(expected));const before=await status()
    for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
    await until(`Number(document.querySelector('.editor-diagnostics').dataset.history)===${Number(before.history)+1}`)
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Component Editor workspace'));await until(ready);await newDocument();await rename(assetName)
  if(!await evaluate("!!document.querySelector('.editor-inspector')"))await click(aria('Toggle editor inspector'));await palette('oak_log');await input(aria('State axis'),'x');await build('line',[0,0,0],[1,0,0])
  if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Save to component library')).click()`)
  await library();await click('.editor-library-tabs button:nth-child(2)');await until(`Array.from(document.querySelectorAll('.component-asset-main')).some(button=>button.textContent.includes(${JSON.stringify(assetName)}))`)
  const baseline=await assetJSON();assert.deepEqual(sorted(flatten(baseline.objects)),sorted([cell('oak_log',[0,0,0],{axis:'x'}),cell('oak_log',[1,0,0],{axis:'x'})]))
  await click(aria('Architecture workspace'));await until(ready);await newDocument();await rename(name);await palette('oak_planks')
  for(const y of [0,3])await build('plane',[0,y,0],[4,y,4])
  await build('line',[4,1,1],[4,1,1])
  const shell=[];for(const y of [0,3])for(let z=0;z<5;z++)for(let x=0;x<5;x++)shell.push(cell('oak_planks',[x,y,z]));shell.push(cell('oak_planks',[4,1,1]))
  const lower=[cell('oak_log',[1,1,1],{axis:'x'}),cell('oak_log',[2,1,1],{axis:'x'})]
  // Clockwise yaw maps the source +X span to +Z and the X log axis to Z.
  const upper=[cell('oak_log',[1,4,1],{axis:'z'}),cell('oak_log',[1,4,2],{axis:'z'})]
  await place(1,0,lower);await verify([...shell,...lower]);await place(4,1,upper)
  const original=await verify([...shell,...lower,...upper]),copies=original.objects.filter(object=>object.kind==='component')
  assert.equal(copies.length,2);assert.ok(copies.every(object=>object.componentId===baseline.id));assert.equal(new Set(ids(copies)).size,ids(copies).length)
  assert.ok(ids(copies).every(id=>!ids(baseline.objects).includes(id)))
  const lowerRoot=copies.find(object=>flatten([object]).some(entry=>entry.pos[1]===1)),upperRoot=copies.find(object=>object.id!==lowerRoot.id)
  await range(1,2);await select(lowerRoot.id);const before=await status();await move('cancel');assert.deepEqual(await status(),before);await verify([...shell,...lower,...upper])
  await move('commit');const moved=lower.map(entry=>({...entry,pos:[entry.pos[0]+1,...entry.pos.slice(1)]}));await verify([...shell,...moved,...upper])
  const committed=await status();await move('commit');assert.deepEqual(await status(),committed);await verify([...shell,...moved,...upper])
  await click(aria('Undo editor'));await verify([...shell,...lower,...upper]);await click(aria('Redo editor'));await verify([...shell,...moved,...upper])
  await click(aria('Open materials'));await input(aria('Materials count scope'),'selection');await input(aria('Replacement source material'),'minecraft:oak_log');await input(aria('Replacement target material'),'minecraft:spruce_log');await click(aria('Preview material replacement'));await until(`document.querySelector('.material-action-diagnostics').dataset.valid==='true'`)
  await click(aria('Confirm material replacement'));await until(`!document.querySelector('[aria-label="Confirm material replacement"]')`);await click(aria('Close materials'))
  const replaced=moved.map(entry=>({...entry,state:{...entry.state,name:'minecraft:spruce_log'}})),expected=[...shell,...replaced,...upper],edited=await verify(expected)
  assert.deepEqual(edited.objects.find(object=>object.id===upperRoot.id),upperRoot);assert.deepEqual(await assetJSON(),baseline)
  assert.deepEqual(ids(edited.objects.find(object=>object.id===lowerRoot.id).children),ids(lowerRoot.children))
  assert.equal(edited.objects.find(object=>object.id===lowerRoot.id).componentId,baseline.id)
  await range(4,5);await select(upperRoot.id);await click(aria('Frame editor scene'));await screenshot('component-reuse-upper-floor')
  await click('.document-actions > button.primary');await until(`document.querySelector('.document-saved')`)
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`);await verify(expected)
  await range(1,2);await library();await click('.editor-library-tabs button:nth-child(2)');assert.deepEqual(await assetJSON(),baseline)
  await verify(expected);await screenshot('component-reuse-lower-floor')
  await click(aria('Export Minecraft'));await until(`document.querySelector('[aria-label="Download Minecraft export"]')?.disabled===false`);await input(aria('Export format'),'nbt');await click(aria('Download Minecraft export'))
  const filename=await evaluate(`document.querySelector('.export-footer code').textContent`),bytes=await downloaded(filename),nbt=readHouseStructure(bytes)
  assert.equal(nbt.DataVersion,4903);assert.deepEqual(nbt.size,[5,5,5]);assert.deepEqual(nbt.entities,[])
  assert.deepEqual(sorted(nbt.blocks.map(block=>({pos:block.pos,state:{name:nbt.palette[block.state].Name,properties:nbt.palette[block.state].Properties??{}}}))),sorted(expected))
  await click(aria('Close Export Minecraft'));await writeFile(resolve('artifacts/component-reuse-two-floors.nbt'),bytes)
  const report={componentReuseResult:'passed',cells:expected.length,checks:['empty Component Editor UI authoring and publication','real pointer placement on two floors','independent clockwise yaw expectation and preview parity','fresh nested IDs and library provenance','whole-copy move/cancel/collision/Undo/Redo','selected-copy material replacement; other copy and library unchanged','Save/reload and full JSON/NBT export under Y filter'],limits:['independent copies, not linked instances','two-log component; no logical pair in this fixture','scripted subset, not complete house or participant acceptance','software browser; no real GPU or Minecraft world readback']}
  await writeFile(resolve('artifacts/component-reuse-workflow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
