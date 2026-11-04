import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {cpus,platform,release,totalmem} from 'node:os'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createPerformanceFixture} from './performance-fixtures.mjs'

const summary=values=>{const ordered=[...values].sort((a,b)=>a-b);return {samples:values.length,p50:ordered[Math.ceil(ordered.length*.5)-1]??null,p95:ordered[Math.ceil(ordered.length*.95)-1]??null,max:ordered.at(-1)??null}}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
function highestCell(document){
  let best
  const walk=(object,owner)=>{for(const cell of object.cells)if(!best||cell.pos[1]>best.pos[1])best={...cell,owner};for(const child of object.children)walk(child,owner)}
  for(const object of document.objects)walk(object,object.id)
  return best
}

/** Disposable origin and native events; no direct document/history mutation. */
export async function runPerformanceScenarios({command,evaluate,until,click,aria,upload,key,screenshot,directory}){
  const options=JSON.parse(process.env.BLOCKSTAGE_MEASUREMENT??'null')
  if(!options)throw new Error('Run through measure-editor.mjs for bounded measurement options')
  if(!/^\w[\w.-]*\.json$/.test(options.output))throw new Error('Measurement report requires a bounded artifacts basename')
  const output=resolve('artifacts',options.output),cases=[]
  const report={schemaVersion:1,measurementContract:'p02-submission-v2',status:'running',testedAt:new Date().toISOString(),options,metric:'Native input to matching CPU frame submission, not GPU completion or presentation',cases,limits:['Headless browser; explicit backend identity below','Preview acknowledgement checks final ghost first-cell coordinates, not just the presence of a preview','No GPU timers/FPS/presentation proof','Cold import means new document within a warmed resource process, not cold browser/cache','JS heap and renderer resource counts are observations, not exact GPU/OS memory','Picking/move/undo only; save/history-byte retention and 100k coverage require separate measurements when not run']}
  async function save(){await writeFile(output,JSON.stringify(report,null,2))}
  const revision=()=>evaluate(`Number(document.querySelector('.editor-diagnostics').dataset.revision)`)
  const cells=()=>evaluate(`JSON.parse(document.querySelector('.editor-diagnostics').dataset.snapshot).cells`)
  const measure=()=>evaluate(`JSON.parse(document.querySelector('canvas').dataset.editorMeasurement)`)
  const focus=()=>evaluate(`document.querySelector('canvas').focus()`)
  const keyEvent=(code,keyValue=code,modifiers=0)=>key(code,keyValue,modifiers)
  async function frame(predicate){await until(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorMeasurement??'null'),e=globalThis.__blockstageMeasurement.event;return m&&e&&m.frame>e.frame&&m.submittedAt>=e.at&&(${predicate})})()`);return evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorMeasurement),e=globalThis.__blockstageMeasurement.event;return {latency:m.submittedAt-e.at,cpuSubmission:m.cpuSubmissionMs,startedAt:e.at,submittedAt:m.submittedAt,frame:m}})()`)}
  try{
    await command('Emulation.setDeviceMetricsOverride',{width:1500,height:1000,deviceScaleFactor:1,mobile:false})
    await click(aria('Architecture workspace'));await until(`document.querySelector('.editor-workspace')?.dataset.editorReady==='true'&&document.querySelector('canvas')?.dataset.editorMeasurement`)
    if(!await evaluate(`!!document.querySelector('.editor-inspector')`))await click(aria('Toggle editor inspector'))
    await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:directory})
    report.environment=await evaluate(`(()=>{const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {userAgent:navigator.userAgent,devicePixelRatio,viewport:[innerWidth,innerHeight],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null}})()`)
    report.environment.host={platform:platform(),release:release(),cpu:cpus()[0]?.model??'unknown',threads:cpus().length,memoryBytes:totalmem()}
    const renderer=report.environment.renderer
    report.environment.rendererClass=!renderer?'unknown':/swiftshader|llvmpipe|software|basic render|\bwarp\b/i.test(renderer)?'software':'hardware-reported'
    report.hardwareGate=options.renderer==='hardware'&&report.environment.rendererClass==='hardware-reported'?'renderer-identified-measurement-only':'UNVERIFIED'
    report.resources={clientSha256:hash(await readFile(process.env.BLOCKSTAGE_RESOURCE_PACK)),profileSha256:hash(await readFile(process.env.BLOCKSTAGE_GAME_PROFILE))}
    await evaluate(`(()=>{const state=globalThis.__blockstageMeasurement={event:null,longTasks:[],longTaskSupported:false};document.addEventListener('keydown',record,true);document.addEventListener('pointerdown',record,true);function record(e){if(e.target.tagName!=='CANVAS')return;const m=JSON.parse(e.target.dataset.editorMeasurement??'{}');state.event={at:performance.now(),frame:m.frame??0,code:e.code??'pointer',revision:Number(document.querySelector('.editor-diagnostics').dataset.revision)}}try{if(!globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask'))return;new PerformanceObserver(list=>{for(const entry of list.getEntries())if(state.longTasks.length<2048)state.longTasks.push({start:entry.startTime,duration:entry.duration})}).observe({entryTypes:['longtask']});state.longTaskSupported=true}catch{}})()`)
    for(const kind of options.kinds)for(const count of options.cells){
      await evaluate(`globalThis.__blockstageMeasurement.longTasks.splice(0)`)
      const fixture=createPerformanceFixture({cells:count,kind,seed:options.seed}),bytes=JSON.stringify(fixture.document)
      const result={kind,cells:count,meta:fixture.meta,inputBytes:Buffer.byteLength(bytes),status:'running',phase:'import'};cases.push(result);await save()
      if(result.inputBytes>32*1024**2){result.status='outside-import-budget';await save();continue}
      const file=join(directory,`performance-${kind}-${count}.json`);await writeFile(file,bytes)
      const began=await evaluate('performance.now()')
      await upload(aria('Import editor document'),file)
      await until(`document.querySelector('.editor-diagnostics').dataset.blocks==='${count}'&&document.querySelector('[aria-label="Document name"]').value===${JSON.stringify(fixture.document.name)}&&document.querySelector('.editor-workspace').dataset.editorReady==='true'`)
      await until(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorMeasurement),d=document.querySelector('.editor-diagnostics').dataset;return m.revision?.includes(':'+d.document+':')&&m.revision.endsWith(':'+d.revision)})()`)
      result.importToFrameMs=(await measure()).submittedAt-began
      result.appearance=await evaluate(`({fallbackBlocks:Number(document.querySelector('.editor-diagnostics').dataset.fallback),details:[...document.querySelectorAll('.viewport-diagnostics li')].slice(0,20).map(item=>item.textContent)})`)
      assert.equal(result.appearance.fallbackBlocks,0,'A real-assets baseline cannot time placeholder block geometry')
      result.phase='sampling';await save()
      await click(aria('Select tool'));await click(aria('Editor Y view'));await click(aria('Frame editor scene'));await focus()
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const picked=highestCell(fixture.document),pick=await evaluate(`(()=>{const m=JSON.parse(document.querySelector('canvas').dataset.editorCamera).projection,p=${JSON.stringify(picked.pos.map(value=>value+.5))},q=[0,0,0,0];for(let r=0;r<4;r++)q[r]=m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r];const b=document.querySelector('canvas').getBoundingClientRect();return {x:b.x+(q[0]/q[3]+1)*b.width/2,y:b.y+(1-q[1]/q[3])*b.height/2}})()`)
      const initial=await cells(),move=fixture.meta.commands.moveRoot,chosen=options.selection==='all'?fixture.document.objects.map(object=>object.id):move.selection
      const originalByOwner=new Map(chosen.map(id=>[id,true])),moved=initial.map(cell=>originalByOwner.has(cell.owner)?{...cell,pos:cell.pos.map((value,axis)=>value+move.delta[axis])}:cell)
      const samples={pick:[],preview:[],commit:[],undo:[],cpuSubmission:[]},resources=[],phaseSamples={pick:[],preview:[],commit:[],undo:[]},phaseCalls={pick:[],preview:[],commit:[],undo:[]}
      result.samples=samples
      const previewPosition=moved.find(cell=>cell.owner===chosen[0])?.pos
      assert.ok(previewPosition,'The first selected owner must have a cell in the bounded fixture snapshot')
      for(let round=0;round<options.warmup+options.samples;round++){
        await focus();await keyEvent('KeyQ','q');await keyEvent('KeyA','a',1)
        await command('Input.dispatchMouseEvent',{type:'mouseMoved',...pick})
        await command('Input.dispatchMouseEvent',{type:'mousePressed',...pick,button:'left',buttons:1,clickCount:1})
        await command('Input.dispatchMouseEvent',{type:'mouseReleased',...pick,button:'left',buttons:0,clickCount:1})
        const pickResult=await frame(`m.selected===1&&m.active===${JSON.stringify(picked.owner)}`)
        if(options.selection==='all')await keyEvent('KeyA','a',2)
        else await click(`.outliner-object > button[title=${JSON.stringify(chosen[0])}]`)
        await focus();await keyEvent('KeyG','g');await keyEvent('KeyY','y')
        for(const digit of String(move.delta[1]))await keyEvent(`Digit${digit}`,digit)
        const preview=await frame(`m.preview&&m.selected===${chosen.length}&&JSON.stringify(m.previewFirst)===${JSON.stringify(JSON.stringify(previewPosition))}`)
        assert.deepEqual(await cells(),initial,'Staged preview must not mutate committed cells')
        const before=await revision();await keyEvent('Enter','Enter')
        const commit=await frame(`!m.preview&&m.revision.endsWith(':${before+1}')`)
        assert.deepEqual(await cells(),moved,'Acknowledged commit must contain the intended moved cells')
        await keyEvent('KeyZ','z',2)
        const undo=await frame(`!m.preview&&m.revision.endsWith(':${before+2}')`)
        const phaseEvents=await evaluate(`globalThis.__blockstagePhaseRead?.()??null`)
        assert.ok(phaseEvents&&Array.isArray(phaseEvents.events),'Measured viewport must expose its phase collector')
        assert.deepEqual(await cells(),initial,'Undo returns the fixture cells exactly')
        if(round>=options.warmup){
          samples.pick.push(pickResult.latency);samples.preview.push(preview.latency);samples.commit.push(commit.latency);samples.undo.push(undo.latency);samples.cpuSubmission.push(commit.cpuSubmission);resources.push(commit.frame)
          for(const [action,ack] of Object.entries({pick:pickResult,preview,commit,undo})){
            const totals={},calls={}
            for(const event of phaseEvents?.events??[])if(event.start>=ack.startedAt&&event.start+event.duration<=ack.submittedAt+.01){totals[event.name]=(totals[event.name]??0)+event.duration;calls[event.name]=(calls[event.name]??0)+1}
            if(action==='commit')assert.ok(calls['validation.total']>=1,'Fresh transform commit must include full validation')
            phaseSamples[action].push(totals);phaseCalls[action].push(calls)
          }
          if(samples.commit.length%10===0){result.completedSamples=samples.commit.length;await save()}
        }
      }
      const state=await evaluate(`({longTaskSupported:globalThis.__blockstageMeasurement.longTaskSupported,longTasks:globalThis.__blockstageMeasurement.longTasks.splice(0),heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null})`)
      result.phase='final-correctness';await save();await click(aria('Export editor document'))
      let downloaded
      for(let attempt=0;attempt<100;attempt++){try{downloaded=JSON.parse(await readFile(join(directory,`${fixture.document.name}.blockstage.json`),'utf8'));break}catch{await delay(100)}}
      assert.ok(downloaded,'Complete editor JSON must download after the measurement')
      assert.deepEqual(downloaded.objects,fixture.document.objects,'Every object/cell/state is restored after the final Undo')
      assert.deepEqual(downloaded.entities,fixture.document.entities,'Block transforms leave free entities unchanged')
      await focus();await keyEvent('KeyQ','q')
      await until(`document.querySelector('[aria-label="Draft protection"]')?.dataset.phase==='protected'`)
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      const idleStart=(await measure()).frame;await evaluate('new Promise(resolve=>setTimeout(resolve,1000))');const idleFrames=(await measure()).frame-idleStart
      result.status='measured';result.phase='complete';result.completedSamples=samples.commit.length;result.summary=Object.fromEntries(Object.entries(samples).map(([name,values])=>[name,summary(values)]));result.samples=samples;result.resources=resources;result.longTasks=state;result.idleFramesInOneSecond=idleFrames;result.correctness={sampledCells:initial.length,originalSnapshotSha256:hash(JSON.stringify(initial)),allRoundsPreservedSnapshot:true,fullFixtureSha256:fixture.meta.documentSha256,finalFullObjectsAndEntitiesMatch:true,limits:'Per-action comparisons use bounded editor diagnostics (first64cells); final downloaded JSON checks every object/cell/state/entity against the generator'}
      result.phaseTiming={samples:phaseSamples,calls:phaseCalls,retention:await evaluate(`({limit:4096,dropped:globalThis.__blockstagePhaseRead?.().dropped??0})`),inclusive:true,limits:'Nested durations overlap. React reconciliation/passive effects and uninstrumented gaps are not attributed; absence is not zero work.',summary:Object.fromEntries(Object.entries(phaseSamples).map(([action,rounds])=>{const names=new Set(rounds.flatMap(round=>Object.keys(round)));return [action,Object.fromEntries([...names].map(name=>[name,summary(rounds.map(round=>round[name]??0))]))]}))}
      await screenshot(`performance-${kind}-${count}`);await save()
    }
    report.status=cases.every(entry=>entry.status==='measured')?'measured':'partial';await save()
    console.log(JSON.stringify({performanceResult:report.status,renderer:report.environment.renderer,hardwareGate:report.hardwareGate,cases:cases.map(entry=>({kind:entry.kind,cells:entry.cells,status:entry.status,summary:entry.summary}))}))
  }catch(error){report.status='incomplete';report.error=String(error);const active=cases.at(-1);if(active?.status==='running'){active.status='incomplete';active.error=String(error)}await save();throw error}
}
