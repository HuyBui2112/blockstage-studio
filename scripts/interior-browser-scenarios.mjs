import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {readHouseStructure} from './house-browser-scenarios.mjs'

const sorted=cells=>cells.map(({pos,state})=>({pos,state})).sort((a,b)=>a.pos.join(',').localeCompare(b.pos.join(',')))
const flatten=objects=>objects.flatMap(object=>[...object.cells,...flatten(object.children)])

/** Public controls build a two-floor fixture; JSON downloads inspect the complete document. */
export async function runInteriorScenarios({command,evaluate,until,click,aria,input,key,screenshot,directory,profilePath}){
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const name='Interior two floors',downloads=join(directory,'interior-downloads')
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const profile=JSON.parse(await readFile(profilePath,'utf8'))
  const cell=(id,pos,properties={})=>({pos,state:{name:`minecraft:${id}`,properties:{...profile.blocks.find(block=>block.id===`minecraft:${id}`).defaults,...properties}}})
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`)
  async function vector(prefix,values){for(let i=0;i<3;i++)await input(aria(`${prefix} ${'XYZ'[i]}`),String(values[i]))}
  async function downloaded(filename){for(let i=0;i<100;i++){try{return await readFile(join(downloads,filename))}catch{await delay(100)}}throw new Error(`Missing interior download ${filename}`)}
  async function fullDocument(){await unlink(join(downloads,`${name}.blockstage.json`)).catch(error=>{if(error.code!=='ENOENT')throw error});await click(aria('Export editor document'));return JSON.parse((await downloaded(`${name}.blockstage.json`)).toString())}
  async function verify(expected){const document=await fullDocument();assert.deepEqual(sorted(flatten(document.objects)),sorted(expected));return document}
  async function palette(id){if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'));await input(aria('Search resources'),`minecraft:${id}`);await click(`.resource-item[title="minecraft:${id}"]`)}
  async function build(kind,start,end){await click(aria('Primitive tools'));await click(aria(`Build ${kind}`));await vector('Primitive start',start);await vector('Primitive end',end);await until(`document.querySelector('.primitive-action-diagnostics').dataset.valid==='true'`);const ids=await evaluate(`JSON.parse(document.querySelector('.primitive-action-diagnostics').dataset.snapshot).selection`);await click(aria('Confirm primitive action'));await until(`!document.querySelector('.primitive-action-panel')`);return ids}
  async function viewMenu(){if(!await evaluate(`document.querySelector('.object-view-menu').open`))await click(aria('View tools'))}
  async function range(min,max){const before=await status();await viewMenu();await input(aria('Show Y min'),String(min));await input(aria('Show Y max'),String(max));await click(aria('Apply Y range'));assert.deepEqual(await status(),before)}
  async function select(id){await click(aria('Select tool'));if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'));while(!await evaluate(`!!document.querySelector('.outliner-object > button[title=${JSON.stringify(id)}]')`))await click('.outliner .load-more');await click(`.outliner-object > button[title=${JSON.stringify(id)}]`)}
  async function move(amount,finish){await focus();await key('KeyG','g');await key('KeyX','x');await key(`Digit${amount}`,String(amount));await until(`document.querySelector('.transform-hud')`);await key(finish==='cancel'?'Escape':'Enter',finish==='cancel'?'Escape':'Enter');await until(`!document.querySelector('.transform-hud')`)}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  await click('.document-actions > button[title="Save current draft, then create a new document"]');await until(`(${ready})&&document.querySelector('.editor-diagnostics').dataset.blocks==='0'`)
  await evaluate(`document.querySelector('[aria-label="Document name"]').focus()`);await input(aria('Document name'),name);await focus();await click(aria('Frame editor scene'))
  await until(`document.querySelector('[aria-label="Document name"]').defaultValue===${JSON.stringify(name)}`)
  await palette('oak_planks')
  // Independently enumerate three slabs and boundary walls, with a lower entrance.
  const shell=[]
  for(let y=0;y<=6;y++)for(let z=0;z<=4;z++)for(let x=0;x<=4;x++)if(y%3===0||((x===0||x===4||z===0||z===4)&&!(y<3&&x===2&&z===0)))shell.push(cell('oak_planks',[x,y,z]))
  assert.equal(shell.length,137)
  for(const y of [0,3,6])await build('plane',[0,y,0],[4,y,4])
  for(const [lo,hi] of [[1,2],[4,5]]){
    await build('plane',[0,lo,0],[0,hi,4]);await build('plane',[4,lo,0],[4,hi,4]);await build('plane',[1,lo,4],[3,hi,4])
    if(lo===1){await build('line',[1,lo,0],[1,hi,0]);await build('line',[3,lo,0],[3,hi,0])}
    else await build('plane',[1,lo,0],[3,hi,0])
  }
  await verify(shell)
  await palette('red_bed')
  assert.equal(profile.blocks.find(block=>block.id==='minecraft:red_bed').defaults.facing,'north')
  const lower=(await build('line',[2,1,2],[2,1,2]))[0],upper=(await build('line',[2,4,2],[2,4,2]))[0]
  const bed=(x,y)=>[cell('red_bed',[x,y,2],{part:'foot',occupied:'false'}),cell('red_bed',[x,y,1],{part:'head',occupied:'false'})]
  let expected=[...shell,...bed(2,1),...bed(2,4)]
  const original=await verify(expected)
  await range(1,2);await until(`document.querySelector('.editor-view-diagnostics').dataset.visible==='32'`)
  await select(lower)
  await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await focus();await key('KeyA','a')
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const point=await evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=[2.5,1.5,2.5],q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,...(type==='mouseMoved'?{}:{button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})})
  assert.deepEqual(await evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.selection)`),[lower],'Top ray selects the complete lower bed through the removed slabs')
  assert.equal(await evaluate(`document.querySelector('.outliner-object > button[title=${JSON.stringify(upper)}]').disabled`),true)
  const before=await status();await move(1,'cancel');assert.deepEqual(await status(),before);await verify(expected)
  await move(1,'commit');expected=[...shell,...bed(3,1),...bed(2,4)];await verify(expected)
  assert.equal(Number((await status()).history),Number(before.history)+1)
  // A second +X would enter the wall; rejection must preserve the whole pair and shell.
  const committed=await status();await move(1,'commit');assert.deepEqual(await status(),committed);await verify(expected)
  await click(aria('Undo editor'));await verify([...shell,...bed(2,1),...bed(2,4)])
  await click(aria('Redo editor'));await verify(expected)
  await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await screenshot('interior-lower-cut-desktop')
  await range(4,5);await until(`document.querySelector('.editor-view-diagnostics').dataset.visible==='34'`)
  await select(upper);await move(1,'commit');expected=[...shell,...bed(3,1),...bed(3,4)]
  const edited=await verify(expected)
  assert.equal(edited.objects.find(object=>object.id===lower).kind,'multiblock');assert.equal(edited.objects.find(object=>object.id===upper).kind,'multiblock')
  assert.equal(edited.id,original.id)
  await click(aria('Frame editor scene'));await screenshot('interior-upper-cut-desktop')
  await click('.document-actions > button.primary');await until(`document.querySelector('.document-saved')`)
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`)
  assert.equal(await evaluate(`document.querySelector('.editor-view-diagnostics').dataset.yRange`),'null');await verify(expected)
  // Export while cut: view state never removes the hidden slabs or other floor.
  await range(4,5);await verify(expected)
  await click(aria('Export Minecraft'));await until(`document.querySelector('[aria-label="Download Minecraft export"]')?.disabled===false`)
  await input(aria('Export format'),'nbt');await click(aria('Download Minecraft export'))
  const nbtName=await evaluate(`document.querySelector('.export-footer code').textContent`),bytes=await downloaded(nbtName),nbt=readHouseStructure(bytes)
  assert.equal(nbt.DataVersion,4903);assert.deepEqual(nbt.size,[5,7,5]);assert.deepEqual(nbt.entities,[])
  assert.deepEqual(sorted(nbt.blocks.map(block=>({pos:block.pos,state:{name:nbt.palette[block.state].Name,properties:nbt.palette[block.state].Properties??{}}}))),sorted(expected))
  await click(aria('Close Export Minecraft'))
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  for(const [panel,label] of [['.editor-library','Toggle editor library'],['.editor-inspector','Toggle editor inspector']])if(await evaluate(`!!document.querySelector('${panel}')`))await click(aria(label))
  await click(aria('Frame editor scene'));await screenshot('interior-upper-cut-compact')
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`))
  assert.ok(await evaluate(`(()=>{const b=document.querySelector('canvas').getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.tagName==='CANVAS'})()`))
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await writeFile(resolve('artifacts/interior-two-floors.nbt'),bytes)
  await writeFile(resolve('artifacts/interior-two-floors.expected.json'),JSON.stringify({size:[5,7,5],blocks:sorted(expected)},null,2))
  const report={interiorResult:'passed',geometry:{bounds:[5,7,5],shellCells:137,bedCells:4,total:141},checks:['built from empty with native primitives','complete downloaded JSON coordinate/state comparisons','lower and upper Y cuts','whole bed move/cancel/collision rejection','one-step Undo/Redo','other floor and shell unchanged','Save/reload','full export under Y filter, independently decoded NBT','desktop and compact cut screenshots'],limits:['two-floor fixture without stairs or upper access; not complete house acceptance','scripted workflow; no participant builder evidence','software browser; no real GPU performance','NBT data verification; no Minecraft world readback']}
  await writeFile(resolve('artifacts/interior-workflow.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}
