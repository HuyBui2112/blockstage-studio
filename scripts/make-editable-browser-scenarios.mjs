import assert from 'node:assert/strict'
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

/** Whole stored JSON checks for explicit copy conversion and independent member editing. */
export async function runMakeEditableScenarios({command,evaluate,until,click,aria,input,upload,screenshot,directory}) {
  const name='Editable component fixture', downloads=join(directory,'editable-downloads')
  await mkdir(downloads,{recursive:true});await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  const ready=`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'`
  const action=aria('Make component copies editable')
  const cell=(name,pos,properties={})=>({pos,state:{name:`minecraft:${name}`,properties}})
  const leaf=(id,cells)=>({id,name:id,kind:cells.length===1?'block':'multiblock',cells,children:[],pivot2:cells[0].pos.map(v=>2*v+1),orientation:0})
  function copy(id,offset) {
    return {id,name:id,kind:'component',componentId:'shared-library-source',cells:[],children:[
      leaf(`${id}-log`,[cell('oak_log',[offset,0,0],{axis:'y'})]),
      leaf(`${id}-bed`,[cell('red_bed',[offset+2,0,0],{facing:'east',part:'foot',occupied:'false'}),cell('red_bed',[offset+3,0,0],{facing:'east',part:'head',occupied:'false'})]),
      leaf(`${id}-chest`,[{...cell('chest',[offset+5,0,0],{facing:'north',type:'single',waterlogged:'false'}),blockEntity:{kind:'chest',items:[{slot:26,id:'minecraft:stone',count:64}]}}]),
    ],pivot2:[offset*2+1,1,1],orientation:1}
  }
  const first=copy('editable-first',0),second=copy('editable-second',20)
  const fixture={schemaVersion:2,id:'editable-input',name,workspace:'architecture',target:{gameVersion:'26.2',dataVersion:4903},objects:[first,second],entities:[]}
  const status=()=>evaluate(`(()=>{const d=document.querySelector('.editor-diagnostics').dataset;return {revision:d.revision,history:d.history}})()`)
  async function exported() {
    await unlink(join(downloads,`${name}.blockstage.json`)).catch(error=>{if(error.code!=='ENOENT')throw error})
    await click(aria('Export editor document'))
    for(let n=0;n<100;n++){try{return JSON.parse(await readFile(join(downloads,`${name}.blockstage.json`),'utf8'))}catch{await delay(100)}}
    throw new Error('Editable JSON download missing')
  }
  async function select(id) {
    await click(aria('Select tool'))
    if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
    await click(`.outliner-object > button[title=${JSON.stringify(id)}]`)
  }
  async function save(){await click('.document-actions > button.primary');await until(`!!document.querySelector('.document-saved')`)}
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  await click(aria('Architecture workspace'));await until(ready)
  const file=join(directory,'editable-fixture.json');await writeFile(file,JSON.stringify(fixture));await upload(aria('Import editor document'),file)
  await until(`document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(name)}`)
  await save();await select(first.id)
  await click(aria('Auto connections'))
  const baseline=await exported(),before=await status()
  await until(`!!document.querySelector(${JSON.stringify(action)})`)
  await screenshot('make-editable-before')
  await click(action)
  const expected={...baseline.objects[0],kind:'group'};delete expected.componentId
  assert.deepEqual((await exported()).objects,[expected,baseline.objects[1]])
  assert.equal(Number((await status()).history),Number(before.history)+1)
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(action)})`),false)
  await click(aria('Undo editor'));assert.deepEqual((await exported()).objects,baseline.objects)
  await click(aria('Redo editor'));assert.deepEqual((await exported()).objects,[expected,baseline.objects[1]])
  await click(aria('Auto connections'))
  await click(aria('Ungroup selection'));await select('editable-first-log')
  await input(aria('State axis'),'x')
  const edited=await exported(),expectedLog={...first.children[0],cells:[cell('oak_log',[0,0,0],{axis:'x'})]}
  assert.deepEqual(edited.objects,[expectedLog,first.children[1],first.children[2],second])
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(action)})`),false)
  await click(aria('Undo editor'));assert.deepEqual((await exported()).objects,[...first.children,second])
  await click(aria('Redo editor'));assert.deepEqual((await exported()).objects,edited.objects)
  await save()
  const origin=await evaluate('performance.timeOrigin');await command('Page.reload');await until(`performance.timeOrigin!==${origin}&&(${ready})`)
  assert.deepEqual((await exported()).objects,edited.objects)
  await select(second.id)
  await command('Emulation.setDeviceMetricsOverride',{width:620,height:900,deviceScaleFactor:1,mobile:false})
  if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
  await evaluate(`document.querySelector(${JSON.stringify(action)}).scrollIntoView({block:'center'})`)
  await screenshot('make-editable-compact')
  assert.equal(await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(action)}),r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('button')===b})()`),true)
  await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
  if(!await evaluate(`document.querySelector('.object-view-menu')?.open`))await click(aria('View tools'))
  await click(aria('Lock selected'))
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(action)})`),false)
  await click(aria('Unlock all'))
  await click(aria('3D Preview workspace'));await until(ready)
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(action)})`),false)
  await click(aria('Architecture workspace'));await until(ready)
  assert.deepEqual((await exported()).objects,edited.objects)
  await save()
  console.log(JSON.stringify({makeEditableResult:'passed',checks:['explicit copy-to-group conversion','stored IDs/coordinates/pivots/pairs/chest payload preserved','other copy unchanged','one Undo/Redo restores wrapper and provenance','ungroup then edit one child state','full JSON and Save/reload','noncomponent/locked/read-only action hidden','620px accessible action'],limits:['independent component copies; no linked source update','scripted editor checks, no game world readback']}))
}
