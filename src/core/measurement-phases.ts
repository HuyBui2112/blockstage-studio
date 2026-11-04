export type MeasurementPhase={sequence:number;name:string;start:number;duration:number}
type Collector={events:MeasurementPhase[];sequence:number;dropped:number;owners:number}
let collector:Collector|null=null
const read=()=>({events:collector?.events.slice()??[],dropped:collector?.dropped??0})

/** Enabled only by a measured viewport; never serialize documents or game data. */
export function enableMeasurementPhases(){
  if(!collector){collector={events:[],sequence:0,dropped:0,owners:0};Object.defineProperty(globalThis,'__blockstagePhaseRead',{value:read,configurable:true})}
  collector.owners++
  let released=false
  return ()=>{
    if(released)return
    released=true
    if(collector&&--collector.owners===0){collector=null;if(Object.getOwnPropertyDescriptor(globalThis,'__blockstagePhaseRead')?.value===read)Reflect.deleteProperty(globalThis,'__blockstagePhaseRead')}
  }
}
export function measurePhase<T>(name:string,action:()=>T):T{
  const active=collector
  if(!active)return action()
  const start=performance.now()
  try{return action()}
  finally{
    if(active.events.length===4096){active.events.shift();active.dropped++}
    active.events.push({sequence:++active.sequence,name,start,duration:performance.now()-start})
  }
}

