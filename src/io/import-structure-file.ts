import type {Material} from '../core/catalog'
import type {EditorDocument} from '../editor/model'
import type {StructureImport} from './structure-import'

export async function importStructureFile(file:File,workspace:EditorDocument['workspace'],catalog:Material[],signal:AbortSignal):Promise<StructureImport>{
  if(file.size>16*1024**2)throw new Error('NBT file must be at most 16 MiB')
  if(signal.aborted)throw new DOMException('Import cancelled','AbortError')
  const bytes=await file.arrayBuffer()
  if(signal.aborted)throw new DOMException('Import cancelled','AbortError')
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./structure-import.worker.ts',import.meta.url),{type:'module'})
    const stop=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate()}
    const cancel=()=>{stop();reject(new DOMException('Import cancelled','AbortError'))}
    const timer=setTimeout(()=>{stop();reject(new Error('NBT import exceeded 30 seconds'))},30000)
    signal.addEventListener('abort',cancel,{once:true})
    worker.onmessage=(event:MessageEvent<{result?:StructureImport;error?:string}>)=>{stop();if(event.data.result)resolve(event.data.result);else reject(new Error(event.data.error??'NBT worker returned no result'))}
    worker.onerror=()=>{stop();reject(new Error('Could not read Structure NBT'))}
    worker.onmessageerror=()=>{stop();reject(new Error('Could not receive Structure NBT'))}
    try{worker.postMessage({bytes,name:file.name,workspace,catalog},[bytes])}catch(error){stop();reject(error)}
  })
}
