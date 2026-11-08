import assert from 'node:assert/strict'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

/** Public wall controls with independent geometry; no game/world behavior claim. */
export async function runWallScenarios({command,evaluate,until,click,aria,input,upload,key,screenshot,directory}) {
  const name='Wall openings fixture', downloads=join(directory,'wall-downloads')
  await mkdir(downloads,{recursive:true})
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const snapshot=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot)`)
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  const ghost=()=>evaluate(`JSON.parse(document.querySelector('.wall-action-diagnostics').dataset.snapshot)`)
  const valid=(value=true)=>until(`document.querySelector('.wall-action-diagnostics')?.dataset.valid==='${value}'`)
  const absent=()=>until(`!document.querySelector('[aria-label="Wall preview"]')`)
  const stone={name:'minecraft:stone',properties:{}}
  const existing={id:'wall-existing-log',name:'Existing log in doorway',kind:'block',cells:[{pos:[1,0,0],state:{name:'minecraft:oak_log',properties:{axis:'x'}}}],children:[],pivot2:[3,1,1],orientation:0}
  const fixture={schemaVersion:2,id:'wall-openings-input',name,workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[existing],entities:[]}
  const openings=[{offset:1,bottom:0,width:1,height:2},{offset:4,bottom:1,width:2,height:1}]
  function geometry(start,axis,direction,length,height,holes=[]){
    const cells=[]
    for(let y=0;y<height;y++)for(let at=0;at<length;at++){
      if(holes.some(h=>at>=h.offset&&at<h.offset+h.width&&y>=h.bottom&&y<h.bottom+h.height))continue
      const pos=[...start];pos[1]+=y;pos[axis==='x'?0:2]+=direction*at
      cells.push({pos,state:stone})
    }
    return cells
  }
  const normalized=cells=>cells.map(({pos,state,blockEntity})=>({pos,state,...(blockEntity?{blockEntity}:{})})).sort((a,b)=>a.pos.join(',').localeCompare(b.pos.join(',')))
  async function start(values){for(let i=0;i<3;i++)await input(aria(`Wall start ${'XYZ'[i]}`),String(values[i]))}
  async function wall(){await click(aria('Primitive tools'));await click(aria('Build wall with openings'));await until(`!!document.querySelector('[aria-label="Wall preview"]')`)}
  async function configure({position=[0,0,0],axis='x',direction=1,length=7,height=4}={}){
    await start(position);await input(aria('Wall axis'),axis);await input(aria('Wall direction'),String(direction))
    await input(aria('Wall length'),String(length));await input(aria('Wall height'),String(height))
  }
  async function addHoles(){
    await click(aria('Add doorway'));await click(aria('Add window'))
    await input(aria('Opening 2 offset'),'4')
    await valid()
  }
  async function save(){await click('.document-actions > button.primary');await until(`!!document.querySelector('.document-saved')`)}
  async function exported(){
    await unlink(join(downloads,`${name}.blockstage.json`)).catch(error=>{if(error.code!=='ENOENT')throw error})
    await click(aria('Export editor document'))
    for(let attempt=0;attempt<100;attempt++){
      try{return JSON.parse(await readFile(join(downloads,`${name}.blockstage.json`),'utf8'))}catch{await delay(100)}
    }
    throw new Error('Wall JSON download missing')
  }
  async function hover(){
    const point=await evaluate(`(()=>{const r=document.querySelector('.editor-canvas canvas').getBoundingClientRect();return {x:r.x+r.width*.85,y:r.y+r.height*.8}})()`)
    await command('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  }
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  const file=join(directory,'wall-fixture.json');await writeFile(file,JSON.stringify(fixture));await upload(aria('Import editor document'),file)
  await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(name)}`)
  await until(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells.length===1`)
  await save()
  if(!await evaluate(`!!document.querySelector('.editor-library')`))await click(aria('Toggle editor library'))
  await input(aria('Search resources'),'minecraft:stone');await click('.resource-item[title="minecraft:stone"]')
  const initial=await snapshot(), initialStatus=await status()

  // Signed World axes use an independently enumerated coordinate set.
  for(const axis of ['x','z'])for(const direction of [1,-1]){
    await wall();await configure({position:[-3,2,4],axis,direction,length:3,height:2});await valid()
    assert.deepEqual(normalized((await ghost()).cells),normalized(geometry([-3,2,4],axis,direction,3,2)))
    assert.deepEqual(await snapshot(),initial);await click(aria('Cancel wall action'));await absent()
  }
  await wall();await configure();await addHoles()
  const first=await ghost(),expected=geometry([0,0,0],'x',1,7,4,openings)
  assert.equal(first.addedCells,24);assert.deepEqual(normalized(first.cells),normalized(expected))
  await hover();assert.deepEqual(await ghost(),first,'Numeric wall targeting must ignore pointer hover')
  await input(aria('Wall length'),'8');await valid();assert.equal((await ghost()).addedCells,28)
  assert.deepEqual(await snapshot(),initial)
  await input(aria('Wall length'),'7');await valid();assert.deepEqual(await ghost(),first,'Returning to the same numeric inputs keeps operation IDs stable')
  for(const value of ['0','-1','1.5','1000000']){
    await input(aria('Wall length'),value);await valid(false)
    assert.equal(await evaluate(`document.querySelector('[aria-label="Confirm wall action"]').disabled`),true)
    await key('Enter','Enter');assert.deepEqual(await status(),initialStatus)
  }
  await input(aria('Wall length'),'7');await valid()
  await input(aria('Opening 2 offset'),'1');await valid(false)
  await input(aria('Opening 2 offset'),'7');await valid(false)
  await input(aria('Opening 2 offset'),'4');await valid()
  await screenshot('wall-openings-preview')
  await click(aria('Cancel wall action'));await absent();assert.deepEqual(await snapshot(),initial);assert.deepEqual(await status(),initialStatus)

  await wall();await configure();await addHoles();const exact=await ghost()
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  await screenshot('wall-openings-compact')
  assert.equal(await evaluate(`(()=>{const r=document.querySelector('[aria-label="Wall preview"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`),true)
  for(const label of ['Confirm wall action','Cancel wall action']){
    assert.equal(await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify(aria(label))}),r=button.getBoundingClientRect(),panel=button.closest('[aria-label="Wall preview"]').getBoundingClientRect();return r.left>=Math.max(0,panel.left)&&r.right<=Math.min(innerWidth,panel.right)&&r.top>=Math.max(0,panel.top)&&r.bottom<=Math.min(innerHeight,panel.bottom)&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===button})()`),true,`${label} remains visible and clickable at 620px`)
  }
  await click(aria('Confirm wall action'));await absent()
  const committed=await snapshot()
  assert.deepEqual(normalized(committed.cells),normalized([...existing.cells,...expected]))
  assert.deepEqual(committed.cells.filter(cell=>cell.owner!=='wall-existing-log'),exact.cells)
  assert.equal(Number((await status()).history),Number(initialStatus.history)+1)
  await click(aria('Undo editor'));assert.deepEqual(await snapshot(),initial)
  await click(aria('Redo editor'));assert.deepEqual(await snapshot(),committed)
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  const json=await exported()
  assert.deepEqual(json.objects[0],existing,'Opening preserves the whole pre-existing logical root')
  assert.equal(json.objects.length,25)
  assert.deepEqual(normalized(json.objects.flatMap(root=>root.cells)),normalized([...existing.cells,...expected]))
  assert.ok(json.objects.every(root=>root.kind==='block'&&!Object.hasOwn(root,'generator')&&!Object.hasOwn(root,'wall')))
  await save()
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload')
  await until(`performance.timeOrigin!==${origin}&&(${ready})`)
  assert.deepEqual((await exported()).objects,json.objects,'Baked wall geometry persists without generator schema')

  // A filled wall cell collides; a hole is omission, never a carve command.
  const beforeCollision=await snapshot(),collisionStatus=await status()
  await wall();await configure();await valid(false)
  assert.deepEqual(await snapshot(),beforeCollision)
  await click(aria('Cancel wall action'));await absent();assert.deepEqual(await status(),collisionStatus)
  await wall();await configure({position:[20,0,0],length:5,height:3});await valid()
  await click(aria('Component Editor workspace'));await until(ready);await absent()
  await click(aria('Architecture workspace'));await until(ready);await absent()
  assert.deepEqual(await snapshot(),beforeCollision)
  await click(aria('3D Preview workspace'));await until(ready)
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Primitive tools"]')||!!document.querySelector('[aria-label="Wall preview"]')`),false)
  await click(aria('Architecture workspace'));await until(ready)
  assert.deepEqual(await snapshot(),beforeCollision)
  await save()
  console.log(JSON.stringify({wallResult:'passed',checks:['signed X/Z independent geometry','doorway and window omission','existing root in opening preserved','numeric preview regeneration and stable IDs','pointer isolation','invalid dimensions/openings/budget rejection','cancel and exact atomic Undo/Redo','full downloaded JSON and Save/reload baked geometry','collision rejection','workspace cancellation/read-only Preview','620px panel'],limits:['one-cell-thick baked walls; no linked parametric edits','scripted browser geometry; no Minecraft world readback']}))
}
