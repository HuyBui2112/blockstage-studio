import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {readHouseStructure} from './house-browser-scenarios.mjs'

const sorted=cells=>cells.map(({pos,state})=>({pos,state})).sort((a,b)=>a.pos.join(',').localeCompare(b.pos.join(',')))
const flatten=objects=>objects.flatMap(object=>[...object.cells,...flatten(object.children)])
const ids=objects=>objects.flatMap(object=>[object.id,...ids(object.children)])
const state=(id,properties={})=>({name:`minecraft:${id}`,properties})
const cell=(id,pos,properties={})=>({pos,state:state(id,properties)})
const stairs={facing:'south',half:'bottom',shape:'straight',waterlogged:'false'}
const door={facing:'north',hinge:'left',open:'false',powered:'false'}
const bed={facing:'north',occupied:'false'}
const bench=y=>[cell('oak_log',[1,y,7],{axis:'x'}),cell('oak_log',[2,y,7],{axis:'x'})]

// The expected map is specified independently of UI primitive decomposition and all
// editor planners. These are cell/headroom checks, not a Minecraft player simulation.
function houseCells(){
  const cells=[]
  for(let y=0;y<=8;y++)for(let z=0;z<=9;z++)for(let x=0;x<=8;x++){
    const shaft=y===4&&x===6&&z>=2&&z<=5
    const slab=(y===0||y===4||y===8)&&!shaft
    const wall=y%4!==0&&(x===0||x===8||z===0||z===9)
    const entrance=x===4&&z===0&&(y===1||y===2)
    const partition=x===4&&z>=2&&z<=8&&y%4!==0&&!(z===5&&(y%4===1||y%4===2))
    if(slab||partition||(wall&&!entrance))cells.push(cell((x===0||x===8)&&z===4&&y%4!==0?'glass':'oak_planks',[x,y,z]))
  }
  cells.push(cell('oak_door',[4,1,0],{...door,half:'lower'}),cell('oak_door',[4,2,0],{...door,half:'upper'}))
  for(let rise=1;rise<=4;rise++){
    for(let y=1;y<rise;y++)cells.push(cell('oak_planks',[6,y,rise+1]))
    cells.push(cell('oak_stairs',[6,rise,rise+1],stairs))
  }
  for(const y of [1,5])cells.push(cell('red_bed',[2,y,3],{...bed,part:'foot'}),cell('red_bed',[2,y,2],{...bed,part:'head'}))
  return cells
}

function verifyAccess(cells){
  const occupied=new Map(cells.map(entry=>[entry.pos.join(','),entry]))
  assert.equal(occupied.size,cells.length,'House expected map has no duplicate cells')
  const air=pos=>assert.equal(occupied.has(pos.join(',')),false,`Required access/headroom ${pos}`)
  const solid=pos=>assert.ok(occupied.has(pos.join(',')),`Required support ${pos}`)
  // Four consecutive south-facing rises have two wholly empty cells above each
  // step. The upper slab opening is deliberately four cells long, not decorative.
  for(let rise=1;rise<=4;rise++){
    assert.deepEqual(occupied.get([6,rise,rise+1].join(',')).state,state('oak_stairs',stairs))
    solid([6,rise-1,rise+1]);air([6,rise+1,rise+1]);air([6,rise+2,rise+1])
  }
  for(const z of [2,3,4])air([6,4,z])
  for(const [x,y,z] of [[6,1,1],[6,5,6],[5,1,1],[4,1,1],[5,5,6],[5,1,5],[4,1,5],[3,1,5],[5,5,5],[4,5,5],[3,5,5]]){
    solid([x,y-1,z]);air([x,y,z]);air([x,y+1,z])
  }
  for(const y of [1,2])assert.equal(occupied.get([4,y,0].join(',')).state.name,'minecraft:oak_door')
  for(const y of [0,4,8])assert.ok(cells.some(entry=>entry.pos[1]===y),'Both storeys and roof exist')
}

/** One complete scripted house journey through public controls, never document/IDB injection. */
export async function runR1HouseScenarios({command,evaluate,until,click,aria,input,key,screenshot,directory}){
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const name='R1 two-storey house',assetName='R1 reusable bedroom bench',downloads=join(directory,'r1-house-downloads')
  const timings=[],started=performance.now(),shell=houseCells();verifyAccess(shell)
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`)
  const frames=()=>evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const snapshot=()=>evaluate(`document.querySelector('.editor-diagnostics').dataset.snapshot`)
  async function downloaded(filename){for(let i=0;i<100;i++){try{return await readFile(join(downloads,filename))}catch{await delay(100)}}throw new Error(`Missing R1 house download ${filename}`)}
  async function download(label,filename){await unlink(join(downloads,filename)).catch(error=>{if(error.code!=='ENOENT')throw error});await click(aria(label));return JSON.parse((await downloaded(filename)).toString())}
  const fullDocument=()=>download('Export editor document',`${name}.blockstage.json`)
  const assetJSON=()=>download(`Export component ${assetName}`,`${assetName}.component.json`)
  async function verify(expected){const document=await fullDocument();assert.equal(document.schemaVersion,2);assert.deepEqual(document.target,{gameVersion:'26.2',dataVersion:4903});assert.deepEqual(sorted(flatten(document.objects)),sorted(expected));assert.deepEqual(document.entities,[]);return document}
  async function newDocument(){await click('.document-actions > button[title="Save current draft, then create a new document"]');await until(`(${ready})&&document.querySelector('.editor-diagnostics').dataset.blocks==='0'`)}
  async function rename(value){await evaluate(`document.querySelector('[aria-label="Document name"]').focus()`);await input(aria('Document name'),value);await focus();await click(aria('Frame editor scene'));await until(`document.querySelector('[aria-label="Document name"]').defaultValue===${JSON.stringify(value)}`)}
  async function library(){if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))}
  async function inspector(){if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))}
  async function palette(id,properties={}){
    await library();await click('.editor-library-tabs button:first-child');await input(aria('Search resources'),`minecraft:${id}`);await click(`.resource-item[title="minecraft:${id}"]`);await inspector()
    for(const [property,value] of Object.entries(properties)){
      const selector=aria(`State ${property}`),checkbox=await evaluate(`document.querySelector(${JSON.stringify(selector)})?.type==='checkbox'`)
      if(checkbox){if(await evaluate(`String(document.querySelector(${JSON.stringify(selector)}).checked)`)!==value)await click(selector)}
      else await input(selector,value)
    }
  }
  async function vector(prefix,values){for(let i=0;i<3;i++)await input(aria(`${prefix} ${'XYZ'[i]}`),String(values[i]))}
  async function build(kind,start,end){
    await click(aria('Primitive tools'));await click(aria(`Build ${kind}`));await vector('Primitive start',start);await vector('Primitive end',end)
    await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='true'`)
    const roots=await evaluate(`JSON.parse(document.querySelector('.primitive-action-diagnostics').dataset.snapshot).selection`),before=await status()
    const at=performance.now();await click(aria('Confirm primitive action'));await until(`!document.querySelector('.primitive-action-panel')`)
    assert.equal(Number((await status()).history),Number(before.history)+1)
    if(timings.length<8){await frames();timings.push({action:`build ${kind}`,milliseconds:Math.round((performance.now()-at)*10)/10})}
    return roots
  }
  async function viewMenu(){if(!await evaluate(`document.querySelector('.object-view-menu').open`))await click(aria('View tools'))}
  async function range(min,max){const before=await status();await viewMenu();await input(aria('Show Y min'),String(min));await input(aria('Show Y max'),String(max));await click(aria('Apply Y range'));assert.deepEqual(await status(),before)}
  async function clearRange(){await viewMenu();if(!await evaluate(`document.querySelector('[aria-label="Clear Y range"]').disabled`))await click(aria('Clear Y range'))}
  async function select(id){await click(aria('Select tool'));await inspector();while(!await evaluate(`!!document.querySelector('.outliner-object > button[title=${JSON.stringify(id)}]')`))await click('.outliner .load-more');await click(`.outliner-object > button[title=${JSON.stringify(id)}]`)}
  async function move(cancel){await focus();await key('KeyG','g');await key('KeyX','x');await key('Digit1','1');await until(`document.querySelector('.transform-hud')`);await key(cancel?'Escape':'Enter',cancel?'Escape':'Enter');await until(`!document.querySelector('.transform-hud')`)}
  async function placeBench(y){
    await clearRange();await library();await click('.editor-library-tabs button:nth-child(2)');await input(aria('Search components'),assetName)
    await click('.component-asset-main');await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await range(y,y+2);await input(aria('Placement grid Y'),String(y));await click('.component-asset-main');await focus();await frames()
    const point=await evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=[1.5,${y},7.5],q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await until(`document.querySelector('.editor-placement-diagnostics').dataset.valid==='true'`)
    assert.deepEqual(sorted(await evaluate(`JSON.parse(document.querySelector('.editor-placement-diagnostics').dataset.snapshot).cells`)),sorted(bench(y)))
    const before=await status()
    for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
    await until(`Number(document.querySelector('.editor-diagnostics').dataset.history)===${Number(before.history)+1}`)
  }
  async function replace(source,target,cancel=false){
    await click(aria('Open materials'));await input(aria('Materials count scope'),'selection');await input(aria('Replacement source material'),`minecraft:${source}`);await input(aria('Replacement target material'),`minecraft:${target}`)
    const before=await status(),data=await snapshot();await click(aria('Preview material replacement'));await until(`document.querySelector('.material-action-diagnostics').dataset.valid==='true'`)
    assert.deepEqual(await status(),before);assert.equal(await snapshot(),data)
    await click(aria(cancel?'Cancel material replacement':'Confirm material replacement'));await until(`!document.querySelector('[aria-label="Confirm material replacement"]')`);await click(aria('Close materials'))
    assert.equal(Number((await status()).history),Number(before.history)+(cancel?0:1))
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  // Author and publish an actual reusable component before assembling the house.
  await click(aria('Component Editor workspace'));await until(ready);await newDocument();await rename(assetName);await palette('oak_log',{axis:'x'});await build('line',[0,0,0],[1,0,0])
  await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Save to component library')).click()`)
  await library();await click('.editor-library-tabs button:nth-child(2)');await input(aria('Search components'),assetName);await until(`document.querySelector('.component-asset-main')`)
  const baseline=await assetJSON();assert.deepEqual(sorted(flatten(baseline.objects)),sorted([cell('oak_log',[0,0,0],{axis:'x'}),cell('oak_log',[1,0,0],{axis:'x'})]))
  await click(aria('Architecture workspace'));await until(ready);await newDocument();await rename(name);await palette('oak_planks')
  // UI decomposition intentionally differs from the expected map's volume scan.
  await build('plane',[0,0,0],[8,0,9])
  for(const [start,end] of [[[0,4,0],[5,4,9]],[[7,4,0],[8,4,9]],[[6,4,0],[6,4,1]],[[6,4,6],[6,4,9]]])await build('plane',start,end)
  await build('plane',[0,8,0],[8,8,9])
  for(const lo of [1,5]){
    const hi=lo+2
    for(const x of [0,8])for(const [z1,z2] of [[0,3],[5,9]])await build('plane',[x,lo,z1],[x,hi,z2])
    await build('plane',[1,lo,9],[7,hi,9])
    if(lo===1){await build('plane',[1,lo,0],[3,hi,0]);await build('plane',[5,lo,0],[7,hi,0]);await build('line',[4,hi,0],[4,hi,0])}
    else await build('plane',[1,lo,0],[7,hi,0])
    for(const [z1,z2] of [[2,4],[6,8]])await build('plane',[4,lo,z1],[4,hi,z2])
    await build('line',[4,hi,5],[4,hi,5])
  }
  for(let rise=2;rise<=4;rise++)await build('line',[6,1,rise+1],[6,rise-1,rise+1])
  await palette('glass');for(const x of [0,8])for(const y of [1,5])await build('line',[x,y,4],[x,y+2,4])
  await palette('oak_stairs',stairs);for(let rise=1;rise<=4;rise++)await build('line',[6,rise,rise+1],[6,rise,rise+1])
  await palette('oak_door',door);await build('line',[4,1,0],[4,1,0])
  await palette('red_bed',bed);const lowerBed=(await build('line',[2,1,3],[2,1,3]))[0];await build('line',[2,5,3],[2,5,3])
  await verify(shell)
  await placeBench(1);await placeBench(5)
  let expected=[...shell,...bench(1),...bench(5)]
  const assembled=await verify(expected),copies=assembled.objects.filter(object=>object.kind==='component')
  assert.equal(copies.length,2);assert.ok(copies.every(object=>object.componentId===baseline.id));assert.equal(new Set(ids(copies)).size,ids(copies).length);assert.ok(ids(copies).every(id=>!ids(baseline.objects).includes(id)))
  const lower=copies.find(object=>flatten([object]).some(entry=>entry.pos[1]===1)),upper=copies.find(object=>object.id!==lower.id)
  await clearRange();await click(aria('Select tool'));await click(aria('Frame editor scene'));await focus();await key('Numpad1','1',2);await key('Numpad4','4');await key('Numpad8','8');await frames();await screenshot('r1-house-exterior')
  // Edit interior furniture under a lower-storey cut. Whole JSON comparison catches
  // any damage to the other floor, roof, windows, door, stair opening or source.
  await range(1,3);await select(lower.id);const before=await status();await move(true);assert.deepEqual(await status(),before);await verify(expected)
  await move(false);const moved=bench(1).map(entry=>({...entry,pos:[entry.pos[0]+1,...entry.pos.slice(1)]}))
  expected=[...shell,...moved,...bench(5)];await verify(expected);assert.equal(Number((await status()).history),Number(before.history)+1)
  const committed=await status();await move(false);assert.deepEqual(await status(),committed);await verify(expected)
  await click(aria('Undo editor'));await verify([...shell,...bench(1),...bench(5)]);await click(aria('Redo editor'));await verify(expected)
  await replace('oak_log','spruce_log',true);await verify(expected);await replace('oak_log','spruce_log')
  const editedBench=moved.map(entry=>({...entry,state:state('spruce_log',{axis:'x'})}));expected=[...shell,...editedBench,...bench(5)]
  const edited=await verify(expected);assert.deepEqual(edited.objects.find(object=>object.id===upper.id),upper);assert.deepEqual(ids(edited.objects.find(object=>object.id===lower.id).children),ids(lower.children));assert.equal(edited.objects.find(object=>object.id===lowerBed).kind,'multiblock')
  await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await screenshot('r1-house-lower-interior')
  // A legal whole-house timber variant preserves every stair/door/bed state.
  await clearRange();await click(aria('Select tool'));await focus();await key('KeyA','a');await replace('oak_planks','spruce_planks')
  expected=expected.map(entry=>entry.state.name==='minecraft:oak_planks'?{...entry,state:state('spruce_planks')}:entry);await verify(expected)
  await click(aria('Undo editor'));await verify([...shell,...editedBench,...bench(5)]);await click(aria('Redo editor'));await verify(expected)
  await range(5,7);await select(upper.id);await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await screenshot('r1-house-upper-interior')
  await library();await click('.editor-library-tabs button:nth-child(2)');await input(aria('Search components'),assetName);assert.deepEqual(await assetJSON(),baseline)
  await click('.document-actions > button.primary');await until(`document.querySelector('.document-saved')`)
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`)
  const restored=await verify(expected);assert.equal(restored.id,assembled.id);assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.yRange`),'null')
  await range(5,7);await verify(expected)
  await click(aria('Export Minecraft'));await until(`document.querySelector('[aria-label="Download Minecraft export"]')?.disabled===false`);await input(aria('Export format'),'nbt');await click(aria('Download Minecraft export'))
  const filename=await evaluate(`document.querySelector('.export-footer code').textContent`),bytes=await downloaded(filename),nbt=readHouseStructure(bytes)
  assert.equal(nbt.DataVersion,4903);assert.deepEqual(nbt.size,[9,9,10]);assert.deepEqual(nbt.entities,[])
  assert.deepEqual(sorted(nbt.blocks.map(block=>({pos:block.pos,state:{name:nbt.palette[block.state].Name,properties:nbt.palette[block.state].Properties??{}}}))),sorted(expected))
  await click(aria('Close Export Minecraft'))
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  for(const [panel,label] of [['.editor-library','Toggle editor library'],['.editor-inspector','Toggle editor inspector']])if(await evaluate(`!!document.querySelector('${panel}')`))await click(aria(label))
  await click(aria('Frame editor scene'));await screenshot('r1-house-upper-compact');assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`));assert.ok(await evaluate(`(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.tagName==='CANVAS'})()`))
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await writeFile(resolve('artifacts/r1-house.nbt'),bytes);await writeFile(resolve('artifacts/r1-house.expected.json'),JSON.stringify({size:[9,9,10],blocks:sorted(expected)},null,2));await writeFile(resolve('artifacts/r1-house.blockstage.json'),JSON.stringify(restored,null,2))
  const times=timings.map(sample=>sample.milliseconds).sort((a,b)=>a-b),percentile=p=>times[Math.ceil(times.length*p)-1]
  const report={r1HouseResult:'passed',geometry:{bounds:[9,9,10],cells:expected.length,storeys:2,partitionedRooms:4,windows:4,roof:'flat full slab at Y8',stair:{rises:4,axis:'+Z',floorOpening:[[6,4,2],[6,4,3],[6,4,4],[6,4,5]],headroom:'two empty cells above every stair; supported approach and upper landing'},beds:2,componentCopies:2},checks:['empty Component Editor authoring/publication','empty Architecture UI primitives; no authored document import or storage/action injection','independent full expected map, stair support/opening/headroom/access','real pointer component placement on both storeys; fresh nested IDs and provenance','lower Y-cut move/cancel/collision/Undo/Redo; whole other floor unchanged','selected-copy log replacement and whole-house timber variant, cancel/Undo/Redo','library source unchanged','Save/reload and complete JSON/NBT under upper Y cut','desktop exterior/interiors and 620px cut screenshot'],timing:{metric:'CDP harness action-to-two-animation-frames latency',stage:'primitive confirm to panel absent plus two animation frames',softwareRenderer:true,sampleCount:times.length,p50Milliseconds:percentile(.5),p95Milliseconds:percentile(.95),samples:timings,journeyMilliseconds:Math.round(performance.now()-started),limits:'includes CDP/harness overhead; no GPU timing, FPS or performance SLA; real-hardware P02 remains unverified'},limits:['scripted journey, not participant builder usability evidence','geometric stair access/headroom only, not player traversal or game support simulation','independent component copies, not linked instances','NBT data verification, not Minecraft vanilla/Fabric world readback','no entity/payload/portable recovery coverage in this journey; separate gates remain']}
  await writeFile(resolve('artifacts/r1-house-workflow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
