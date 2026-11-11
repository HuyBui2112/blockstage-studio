import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Native rays and input; fixture imports only set up immutable neighboring roots. */
export async function runDoorHingeScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory,profilePath}) {
  const profile=JSON.parse(await readFile(profilePath,'utf8'))
  const cell=(id,pos,properties={})=>({pos,state:{name:`minecraft:${id}`,properties:{...profile.blocks.find(block=>block.id===`minecraft:${id}`).defaults,...properties}}})
  const root=(id,cells)=>({id,name:id,kind:cells.length===1?'block':'multiblock',cells,children:[],pivot2:cells[0].pos.map(value=>2*value+1),orientation:0})
  const floor=[root('floor',[cell('stone',[0,0,0])]),root('second-floor',[cell('stone',[1,0,0])])]
  const pair=(id,pos)=>root(id,[cell('oak_door',pos,{half:'lower',facing:'north',hinge:'left'}),cell('oak_door',[pos[0],pos[1]+1,pos[2]],{half:'upper',facing:'north',hinge:'left'})])
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const snapshot=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const history=()=>evaluate(`Number(document.querySelector('.editor-diagnostics').dataset.history)`)
  const ghost=()=>evaluate(`JSON.parse(document.querySelector('.editor-placement-diagnostics').dataset.snapshot)`)
  let sequence=0
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  async function imported(neighbors=[]) {
    const name=`Door hinge fixture ${++sequence}`
    const document={schemaVersion:2,id:`door-hinge-${sequence}`,name,workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[...floor,...neighbors],entities:[]}
    const path=join(directory,`${document.id}.json`);await writeFile(path,JSON.stringify(document));await upload(aria('Import editor document'),path)
    await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(name)}`)
    await click(aria('Frame editor scene'));await click(aria('Editor Y view'))
    await click('.editor-library-tabs button:first-child');await input(aria('Search resources'),'minecraft:oak_door')
    await click('.resource-item[title="minecraft:oak_door"]')
    await input(aria('Placement mode'),'context');await input(aria('State facing'),'north')
    await input(aria('State hinge'),'right')
  }
  async function point(world) {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    return evaluate(`(()=>{const canvas=document.querySelector('.editor-workspace canvas'),m=JSON.parse(canvas.dataset.editorCamera).projection,p=${JSON.stringify(world)},q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=canvas.getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
  }
  async function hover(world,expected) {
    const position=await point(world)
    const target=[Math.floor(world[0]),1,Math.floor(world[2])]
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...position})
    await until(`(()=>{const d=document.querySelector('.editor-placement-diagnostics');if(!d?.dataset.snapshot)return false;const p=JSON.parse(d.dataset.snapshot);return p.cells.length===2&&p.cells[0].pos.join(',')===${JSON.stringify(target.join(','))}&&p.cells.every(cell=>cell.state.properties.hinge===${JSON.stringify(expected)})})()`)
    return position
  }
  async function press(position) {
    await command('Input.dispatchMouseEvent',{type:'mousePressed',...position,button:'left',buttons:1,clickCount:1})
    await command('Input.dispatchMouseEvent',{type:'mouseReleased',...position,button:'left',buttons:0,clickCount:1})
  }
  async function commit(position) {
    const before=await snapshot(),beforeHistory=await history(),candidate=await ghost()
    assert.equal(await evaluate(`document.querySelector('.editor-placement-diagnostics').dataset.valid`),'true')
    await press(position)
    await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.length===${before.cells.length+2}`)
    const after=await snapshot(),positions=new Set(candidate.cells.map(cell=>cell.pos.join(',')))
    assert.deepEqual(after.cells.filter(cell=>positions.has(cell.pos.join(','))).map(({pos,state})=>({pos,state})),candidate.cells,'Committed door pair must equal the finalized ghost exactly')
    assert.deepEqual(after.cells.filter(cell=>!positions.has(cell.pos.join(','))),before.cells,'Placement must preserve every neighboring root')
    assert.equal(await history(),beforeHistory+1,'Both halves must be one Undo step')
    return {before,after}
  }
  await imported()
  const start=await snapshot(),startHistory=await history()
  await hover([.25,1,.5],'left')
  await hover([.75,1,.5],'right')
  assert.deepEqual(await snapshot(),start);assert.equal(await history(),startHistory)
  await evaluate(`document.querySelector('.editor-workspace canvas').focus()`);await key('Escape','Escape')
  await until(`document.querySelector('.editor-workspace canvas').dataset.editorTool==='select'`)
  assert.deepEqual(await snapshot(),start);assert.equal(await history(),startHistory)

  // A right-hand obstruction outweighs the click's left-hand preference.
  await imported([root('right-wall',[cell('stone',[1,1,0])])])
  const obstruction=await commit(await hover([.25,1,.5],'right'))
  await screenshot('editor-door-context-obstruction')
  await click(aria('Undo editor'));await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.length===${obstruction.before.cells.length}`)
  assert.deepEqual((await snapshot()).cells,obstruction.before.cells)
  await click(aria('Redo editor'));await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.length===${obstruction.after.cells.length}`)
  assert.deepEqual((await snapshot()).cells,obstruction.after.cells)

  // Existing lower neighboring doors take priority and remain unchanged.
  await imported([pair('left-door',[-1,1,0])])
  await commit(await hover([.25,1,.5],'right'))

  // Keep a previously previewed target, then change its neighboring occupancy.
  // Returning to that target must derive a fresh opposite hinge before committing.
  await imported()
  await hover([.75,1,.5],'right')
  await commit(await hover([1.25,1,.5],'left'))
  await commit(await hover([.75,1,.5],'left'))
  await screenshot('editor-door-context-neighbor-refresh')

  // Unsupported collision geometry stays explicit, with an actionable reason.
  await imported([root('unknown-collision',[cell('flower_pot',[1,1,0])])])
  await hover([.25,1,.5],'right')
  assert.ok((await ghost()).notes.some(note=>/hinge.*collision|collision.*hinge/i.test(note)))
  await commit(await hover([.25,1,.5],'right'))

  // Design does not derive hinge/open/power, even where Context would choose left.
  await imported();await input(aria('Placement mode'),'design')
  for(const property of ['open','powered']) {
    if(!await evaluate(`document.querySelector(${JSON.stringify(aria(`State ${property}`))}).checked`))await click(aria(`State ${property}`))
    await until(`document.querySelector(${JSON.stringify(aria(`State ${property}`))}).checked===true`)
  }
  const explicit=await hover([.25,1,.5],'right')
  await until(`(()=>{const d=document.querySelector('.editor-placement-diagnostics');if(!d?.dataset.snapshot)return false;return JSON.parse(d.dataset.snapshot).cells.every(cell=>cell.state.properties.open==='true'&&cell.state.properties.powered==='true')})()`)
  const candidate=await ghost()
  assert.ok(candidate.cells.every(cell=>cell.state.properties.open==='true'&&cell.state.properties.powered==='true'))
  await commit(explicit)
  console.log(JSON.stringify({doorHingeResult:'passed',checks:['left/right hit side','ghost and cancel preserve document/history','solid obstruction priority','adjacent lower door priority','final ghost equals complete committed pair','neighbors unchanged','one Undo/Redo restores exact cells','changed neighboring occupancy invalidates old hinge','unknown collision keeps explicit hinge with reason','Design retains explicit hinge/open/power'],limits:['scripted editor browser input; runtime predicates verified separately','no Fabric or human builder acceptance']}))
}
