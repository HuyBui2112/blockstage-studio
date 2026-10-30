import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function runNeighborScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory,profilePath}){
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'))
  if(!await evaluate(`Boolean(document.querySelector('.editor-library'))`))await click(aria('Toggle editor library'))
  if(!await evaluate(`Boolean(document.querySelector('.editor-inspector'))`))await click(aria('Toggle editor inspector'))
  const profile=JSON.parse(await readFile(profilePath,'utf8'))
  const object=(id,name,pos)=>({id,name,kind:'block',cells:[{pos,state:{name:`minecraft:${name}`,properties:{...profile.blocks.find(b=>b.id===`minecraft:${name}`).defaults}}}],children:[],pivot2:pos.map(v=>v*2+1),orientation:0})
  const snapshot=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const history=()=>evaluate(`Number(document.querySelector('.editor-diagnostics').dataset.history)`)
  const props=async id=>(await snapshot()).cells.find(c=>c.owner===id).state.properties
  async function load(name,objects){
    const path=join(directory,'neighbor.json');await writeFile(path,JSON.stringify({schemaVersion:2,id:name,name,workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects,entities:[]}))
    await upload(aria('Import editor document'),path);await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(name)}`)
    await click(aria('Editor Y view'));await click(aria('Frame editor scene'))
  }
  async function palette(name){await click('.editor-library-tabs button:first-child');await input(aria('Search resources'),`minecraft:${name}`);await click(`.resource-item[title="minecraft:${name}"]`)}
  async function placeAt(world){
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const point=await evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=${JSON.stringify(world)},q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
    await until(`document.querySelector('.editor-placement-diagnostics').dataset.valid==='true'`)
    const ghost=await evaluate(`JSON.parse(document.querySelector('.editor-placement-diagnostics').dataset.snapshot).cells`)
    for(const type of ['mousePressed','mouseReleased'])await command('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1})
    return ghost
  }
  await load('Scene fence connections',[object('left','oak_fence',[0,0,0]),object('right','birch_fence',[2,0,0])])
  const before=await snapshot(),past=await history()
  assert.equal(await evaluate(`document.querySelector('[aria-label="Auto connections"]').disabled`),false)
  await click(aria('Auto connections'))
  assert.deepEqual(await snapshot(),before,'Opt-in must not rewrite an imported scene')
  assert.equal(await history(),past)
  await palette('oak_fence')
  const ghost=await placeAt([1.5,0,.5])
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='3'`)
  const connected=await snapshot()
  assert.equal((await props('left')).east,'true');assert.equal((await props('right')).west,'true')
  for(const cell of ghost)assert.deepEqual(connected.cells.find(c=>c.pos.join(',')===cell.pos.join(','))?.state,cell.state,'Ghost must include the same updated neighbors as commit')
  assert.equal(ghost.length,3);assert.equal(await history(),past+1)
  await evaluate(`document.querySelector('canvas').focus()`);await key('Escape','Escape')
  await click(aria('Editor Z view'));await click(aria('Frame editor scene'));await screenshot('editor-auto-fences')
  await evaluate(`document.querySelector('canvas').focus()`)
  await key('KeyG','g');await key('KeyZ','z');await key('Digit2','2');await key('Enter','Enter')
  await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.some(c=>c.pos[2]===2)`)
  assert.equal((await props('left')).east,'false');assert.equal((await props('right')).west,'false')
  await click(aria('Undo editor'));assert.deepEqual((await snapshot()).cells,connected.cells)
  await evaluate(`document.querySelector('canvas').focus()`);await key('Delete','Delete')
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='2'`)
  assert.equal((await props('left')).east,'false');assert.equal((await props('right')).west,'false')
  await click(aria('Undo editor'));assert.deepEqual((await snapshot()).cells,connected.cells)
  await click(aria('Redo editor'));assert.equal((await props('left')).east,'false')
  await click(aria('Undo editor'))
  await evaluate(`document.querySelector('canvas').focus()`);await key('KeyA','a')
  await until(`document.querySelector('canvas').dataset.selectionCount==='3'`)
  await key('KeyG','g',2)
  await until(`document.querySelector('.editor-diagnostics').dataset.objects==='1'`)
  await key('KeyG','g');await key('KeyX','x');await key('Digit4','4');await key('Enter','Enter')
  await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.every(c=>c.pos[0]>=4)`)
  assert.equal((await snapshot()).cells.filter(c=>c.state.properties.east==='true').length,2)

  await load('Scene wall connections',[object('wall','cobblestone_wall',[0,0,0]),object('north','stone',[0,0,-1]),object('south','stone',[0,0,1])])
  await palette('stone');await placeAt([.5,1,.5])
  await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='4'`)
  assert.equal((await props('wall')).north,'tall');assert.equal((await props('wall')).south,'tall');assert.equal((await props('wall')).up,'false')
  await evaluate(`document.querySelector('canvas').focus()`);await key('Escape','Escape');await click(aria('Editor Z view'));await screenshot('editor-auto-walls')
  await evaluate(`document.querySelector('canvas').focus()`)
  await key('Delete','Delete');await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='3'`)
  assert.equal((await props('wall')).north,'low');assert.equal((await props('wall')).south,'low')
  const scene=await snapshot();await click(aria('Auto connections'));assert.deepEqual(await snapshot(),scene)
  console.log(JSON.stringify({neighborResult:'passed',checks:['opt-in without mutation','fence ghost includes adjacent updates','atomic placement/move/delete/undo/redo','nested group move','wall cover tall/low/post','explicit policy off']}))
}
