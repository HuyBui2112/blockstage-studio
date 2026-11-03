import {spawn} from 'node:child_process'
import {parseArgs} from 'node:util'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {existsSync} from 'node:fs'

export function measurementOptions(args){
  const {values}=parseArgs({args,options:{cells:{type:'string',default:'1000,10000'},kinds:{type:'string',default:'dense'},samples:{type:'string',default:'30'},warmup:{type:'string',default:'3'},seed:{type:'string',default:'1'},renderer:{type:'string',default:'hardware'},selection:{type:'string',default:'root'},output:{type:'string',default:'editor-performance.json'}}})
  const integer=(text,min,max)=>{if(!/^\d+$/.test(text))throw new Error('Measurement integers must be unsigned decimal');const value=Number(text);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Error(`Measurement number must be ${min}–${max}`);return value}
  const cells=[...new Set(values.cells.split(',').map(value=>integer(value,1,100000)))]
  const allowed=['dense','sparse','mixed','transparent','pairs','component','entity'],kinds=[...new Set(values.kinds.split(','))]
  if(cells.length>3||kinds.some(kind=>!allowed.includes(kind))||!['hardware','software'].includes(values.renderer)||!['root','all'].includes(values.selection)||!/^\w[\w.-]*\.json$/.test(values.output))throw new Error('Invalid measurement size/kind/renderer/selection/output basename')
  return {cells,kinds,samples:integer(values.samples,1,100),warmup:integer(values.warmup,0,20),seed:integer(values.seed,0,4294967295),renderer:values.renderer,selection:values.selection,output:values.output}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=measurementOptions(process.argv.slice(2)),url=new URL(process.env.BLOCKSTAGE_URL??'http://127.0.0.1:4184/')
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Measurement requires a local application URL')
  for(const key of ['BLOCKSTAGE_RESOURCE_PACK','BLOCKSTAGE_GAME_PROFILE'])if(!process.env[key]||!existsSync(process.env[key]))throw new Error(`Supply the existing local ${key} file`)
  url.searchParams.set('measure','1')
  const child=spawn(process.execPath,['scripts/smoke-browser.mjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,BLOCKSTAGE_URL:url.href,BLOCKSTAGE_EDITOR_SLICE:'performance',BLOCKSTAGE_RENDERER:options.renderer,BLOCKSTAGE_MEASUREMENT:JSON.stringify(options)}})
  child.on('error',error=>{console.error(error.message);process.exitCode=1})
  child.on('exit',code=>{process.exitCode=code??1})
}
