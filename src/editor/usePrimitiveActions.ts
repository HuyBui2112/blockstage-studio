import { useEffect, useMemo, useRef, useState } from 'react'
import type { Material } from '../core/catalog'
import type { NeighborRules } from '../core/profile'
import type { BlockState, Vec3 } from '../core/schema'
import type { EditorDocument } from './model'
import type { PrimitiveIntent, PrimitiveKind } from './primitive-plan'
import { planPrimitiveAction, type PrimitiveActionPlan } from './primitive-action'
import type { EditorScope } from './useEditorSession'

type Inputs = { document:EditorDocument;scope:EditorScope;revision:number;epoch:string;catalog:Material[];rules?:NeighborRules;state:BlockState;enabled:boolean;resourceKey:unknown;onCommit:(scope:EditorScope,plan:PrimitiveActionPlan)=>boolean }
type Operation = { source:EditorDocument;scope:EditorScope;revision:number;epoch:string;catalog:Material[];rules?:NeighborRules;state:BlockState;resourceKey:unknown;id:string;controller:AbortController;intent:PrimitiveIntent }

export function usePrimitiveActions({document,scope,revision,epoch,catalog,rules,state,enabled,resourceKey,onCommit}:Inputs) {
  const [operation,setOperation]=useState<Operation|null>(null)
  const owned=useRef<AbortController|null>(null)
  const active=operation && enabled && operation.source===document && operation.scope===scope && operation.revision===revision && operation.epoch===epoch && operation.catalog===catalog && operation.rules===rules && operation.state===state && operation.resourceKey===resourceKey ? operation : null
  if(operation&&!active)setOperation(null)
  useEffect(()=>()=>{owned.current?.abort();owned.current=null},[document,scope,enabled,catalog,rules,state,resourceKey])
  const result=useMemo(()=>{
    if(!active)return null
    try{return {plan:planPrimitiveAction(document,active.intent,catalog,{base:{documentId:document.id,sessionEpoch:epoch,revision},operationId:active.id,signal:active.controller.signal},rules),error:''}}
    catch(error){return {plan:null,error:error instanceof Error?error.message:String(error)}}
  },[active,document,catalog,epoch,revision,rules])
  function cancel(){owned.current?.abort();owned.current=null;setOperation(null)}
  function begin(kind:PrimitiveKind,start:Vec3,templateState:BlockState=state){
    if(!enabled)return
    cancel()
    const controller=new AbortController();owned.current=controller
    setOperation({source:document,scope,revision,epoch,catalog,rules,state,resourceKey,id:crypto.randomUUID(),controller,intent:{kind,start:[...start],end:[...start],state:structuredClone(templateState)}})
  }
  function change(intent:PrimitiveIntent){setOperation(previous=>previous?{...previous,intent:{...intent,state:previous.intent.state}}:previous)}
  function point(end:Vec3){
    // Native pointer events can arrive before React publishes begin()'s render.
    // Update the queued operation, preserving its identity and captured template.
    setOperation(previous=>previous&&enabled&&previous.source===document&&previous.scope===scope&&previous.revision===revision&&previous.epoch===epoch&&previous.catalog===catalog&&previous.rules===rules&&previous.state===state&&previous.resourceKey===resourceKey&&end.some((value,index)=>value!==previous.intent.end[index])?{...previous,intent:{...previous.intent,end:[...end]}}:previous)
  }
  function confirm(){if(active&&result?.plan&&onCommit(scope,result.plan)){cancel();return true}return false}
  return {active,result,begin,change,point,confirm,cancel}
}
